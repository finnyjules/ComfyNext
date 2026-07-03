# Surface-B Metering Spike — Findings (2026-07-03)

## What the spike proves
An authenticated Nitro route (`POST /api/meter/prompt`) can:
- price an arbitrary ComfyUI API-format graph in integer credits from a versioned price book;
- check the caller's *available* balance and refuse an underfunded run **before** anything reaches the GPU (HTTP 402, nothing forwarded);
- forward a funded graph to the real engine and capture its `prompt_id`;
- correlate that `prompt_id` to its outcome and debit the ledger **exactly once, on success only** (idempotency key = `prompt_id`);
- strip **all** comfy.org credentials from the forwarded body (§7 hard rule) — the spike has no trusted per-user key store, so `callerSuppliedKey` is always `null` and every `auth_token_comfy_org` / `api_key_comfy_org` the caller sent is dropped rather than passed through. (An earlier draft compared against a key read out of the caller's own untrusted request body — a tautology, since an attacker can simply supply the credential in the body to "match" it. Flagged in review as Critical C1, fixed in commit `5b5762a9c`, human-approved.) Phase 1 re-enables §7 pass-through by comparing against the user's *stored* key (from their Clerk-authenticated session) instead of anything in the request.

All money logic is in-memory mocks whose signatures mirror the real `ledger.ts` (§5.2), so Phase 2 swaps the implementation without changing callers.

## Key engine facts discovered
- **`execution_success` is client-targeted, not broadcast** (`execution.py:793` → `add_message(..., broadcast=False)` → `execution.py:680` targets `self.server.client_id`). A server-side ws listener with its own clientId would not see it. → the spike settles by polling `GET /history/{prompt_id}`, whose entry carries `status: {status_str: 'success'|'error', completed: bool}` (`execution.py:1216`).
- **The canvas submits prompts inside the iframe** via `window.app.queuePrompt` straight to `:8188` (`custom_nodes/comfynext_bridge/js/bridge.js:1126`) — bypassing Nitro. This is the §6 hole.

## Mock → real swap points (for Phases 1–5)
| Spike module | Replaced by | Phase |
|---|---|---|
| `spikeAuth.resolveSpikeUser` (`x-spike-user` header) | Clerk session-JWT middleware, `event.context.userId` | 1 |
| `mockLedger` (in-memory) | Postgres ledger, `SELECT…FOR UPDATE`, real `holds` | 2 |
| `meterStore` (in-memory Map) | Postgres pending/holds rows (survives restart) | 5 |
| `priceBook` (TS table) | Postgres `price_book`, versioned | 3 |
| history-poll settlement | ws-frame inspection once the ws is proxied (optional) | 5 |

Auth note: the spike's stand-in for the Clerk guard reads the caller id from a plain `x-spike-user` request header (`spikeAuth.resolveSpikeUser`) — there is no token verification at all. This is fine for a same-process spike but must not ship; Phase 1 replaces the header read with real Clerk session-JWT verification.

## Known spike limitations (from review)
- **I1 — unbilled run if register() throws after a successful forward().** `meterStore.register` is currently a `Map.set`, which cannot throw, so this can't happen *today*. But `meterPrompt`'s orchestration has no compensating guard (no rollback/void path) if a future `register()` implementation can fail — the run would have already reached the GPU with nothing recorded to bill against. Phase 2's transactional ledger (real DB write, same transaction as the hold) closes this.
- **I2 — the settle watcher is unsupervised fire-and-forget.** `settleOnCompletion` runs as a detached `void` promise inside the request process, polling for up to ~2 minutes (`intervalMs` × `maxPolls`). If the process restarts mid-poll, the in-memory `meterStore` entry is lost and the charge is stranded as `'pending'` forever — never settled, never voided, and never billed. Phase 5 persists pending charges in Postgres so a boot-time reconciler can resume or void them after a restart.
- **M1 — preflight is check-then-act, not atomic.** `getAvailable()` and the eventual `debit()` are two separate steps with no lock between them; two concurrent requests from the same user can both pass the balance check and both reach the GPU. The ledger's debit guard (`amount > balance` at debit time) prevents an outright overdraft — the second debit voids — but a single balance can still *buy* two runs before either settles. Phase 2's reserve/settle (hold at preflight, capture at settlement) closes this by reserving credits before forward() rather than only checking availability.
- **M2 — engine 5xx surfaces as a flat 400 to the client.** `forward()` maps any non-OK ComfyUI response to `MeterError('bad_request', ...)`, which the route turns into HTTP 400 regardless of whether ComfyUI returned a 4xx (bad graph) or 5xx (engine fault). Callers can't currently distinguish "your graph is invalid" from "the engine is unhealthy."

## The remaining unknown: iframe + ws isolation (the real infra effort)
The spike deliberately does NOT re-route the canvas. To ship Surface B, all engine traffic must go through the authed proxy and `:8188` must be private (§6):
1. **Re-host the ComfyUI iframe behind Nitro** so its HTTP (`/prompt`, `/view`, `/upload`, `/object_info`) is served through the authenticated proxy rather than direct-to-`:8188`.
2. **Proxy the ComfyUI websocket** (`/ws`) through Nitro (h3/crossws) — needed both for isolation and, if we later prefer ws-frame settlement over history-polling.
3. **Bind `:8188` to a private interface** on the RunPod topology; only Nitro can reach it.
4. Redirect the bridge's `queuePrompt` through the metered route (or make the proxied `/prompt` itself the meter).

**Estimate:** the HTTP half is small — `comfyui-proxy.ts` already proxies every REST path the canvas needs (`/prompt`, `/view`, `/upload`, `/object_info`, …), so "iframe behind Nitro" is mostly pointing the iframe src at a proxied origin and fixing asset paths (~1–2 days incl. regressions). The ws proxy is the real work: Nitro dev has no first-class ws passthrough, so it needs a crossws/h3 upgrade handler + bidirectional pump + reconnect semantics (~2–3 days to production-shape). Redirecting the bridge's `queuePrompt` through `/api/meter/prompt` is one bridge change (~0.5 day, needs a ComfyUI restart per bridge convention). Call Phase 5 **~1 week** all-in on the RunPod topology, on top of infra provisioning itself.

## Effort estimate for the rest (live smoke results, 2026-07-03)

All four paths verified end-to-end against the real engine through the real route (`frontend-harness` dev server, ComfyUI at `127.0.0.1:8188`):

| Path | Observed |
|---|---|
| Funded success (EmptyImage→SaveImage, 1cr) | priced → forwarded → `prompt_id` returned → **debited 100→99 ~1.1s after submit** (run itself ~0.1s; latency = watcher's 1s poll cadence) |
| Insufficient (0cr wallet, 1cr graph) | **HTTP 402** `{available:0, required:1}`, engine queue length unchanged (nothing forwarded) |
| Runtime failure (LipSyncNode w/ no audio → SaveVideo, 31cr priced) | forwarded, engine errored ~1s, **voided fast, balance unchanged** — no charge |
| Anonymous (no x-spike-user) | **HTTP 401**, no deps invoked |
| Validation-rejected graph | ComfyUI 400 at forward → route 400, nothing registered, no charge |

**Surprise worth its own line — failed runs never set `completed:true`.** The live smoke caught that ComfyUI history marks failures `{status_str:'error', completed:false}`; the watcher originally gated on `completed` and would have voided failures only via the 2-minute timeout. Fixed (`d4fd6bef1`): success requires `status_str==='success' && completed`; error settles on `status_str==='error'` alone. This is the kind of engine-shape fact to re-verify when upgrading ComfyUI.

Nothing observed contradicts the spec's ~a-week-each sizing for Phases 1–3. The metering mechanism itself is proven and cheap; the schedule risk is concentrated in Phase 5's ws/iframe isolation (above) and the separately-tracked multi-tenant data + hosted-GPU tracks.
