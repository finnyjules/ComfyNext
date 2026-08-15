# Stage 4 — Meter Every Provider Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plain-language summary (standing rule):** today, a signed-in hosted user can run any generator and Julien's provider keys pay for it — nothing touches their wallet except the one spiked graph route. After this plan, **every** action that spends provider money in hosted mode first checks the user's credits and then charges their wallet when the job succeeds, priced from the same price book the badges estimate from. Anything unpriced or unattributable **refuses to spend** (fail closed) instead of spending silently. Local mode is bit-for-bit unchanged: no checks, no charges, Julien's keys as always.

**Goal:** hosted-mode metering at the provider chokepoints (`runReplicate`/`runFal`) via request-scoped context, plus explicit metering for the routes that bypass them (training, lip-sync, voice-clone, krea-rewrite, Anthropic assists), with fail-closed policy and live-verified debits into the Neon ledger.

**Architecture:** an `AsyncLocalStorage` request context (bound by the auth middleware) carries `{ userId, priceHintCredits? }` to any depth of the call stack — zero churn at the 15 chokepoint call-site files, and future routes are covered automatically because hosted spend WITHOUT context throws. Pricing resolves slug → `MODEL_COSTS`, else LoRA-category (personal slugs), else route hint, else REFUSE. Charging is preflight-check + debit-on-success keyed by the provider's job id (ledger replay makes retries idempotent).

**Tech Stack:** `node:async_hooks` AsyncLocalStorage, existing `ledger`/`ledgerLive`, `priceBook` (`MODEL_COSTS`, `LORA_RENDER_CREDITS`, `RESTYLE_LORA_CREDITS`), vitest + injected fakes.

## Global Constraints

- **deployMode contract:** local mode = zero metering work, byte-identical behavior. Every meter entry point starts with `if (deployMode() === 'local') return …no-op`.
- **Fail closed in hosted mode:** provider spend with no ALS userId → throw 500 `unmetered spend refused`; unpriced slug with no hint → throw 500 `unpriced model refused` (the price-book coverage test is the safety net that keeps this rare). Insufficient available → throw 402 with `{ required, available }`.
- **Debit-on-success only**, keyed by provider job id (`rep:<prediction_id>`, `fal:<request_id>`, `train:<training_id>`, etc.) — never charge failed/timed-out jobs; never construct keys with reserved prefixes `settle:`/`expire:`.
- Never wrap `getBalance`/`getAvailable` in the ledger mutex; raw session WRITES outside the ledger go through `ledger.withLock` (there are none in this plan — flag if you think you need one).
- **NO commas inside trailing comments on `export const` lines** in server/ (mlly phantom-export outage).
- Components/`~/lib` imports in pages/components are EXPLICIT (nothing outside `~/components/ui` auto-imports).
- Stage ONLY your named files; never `git add -A`. Commits end with: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
- vitest FROM `frontend/`; `--testTimeout=30000` under load; rerun once before believing a failure. No Monitors/background waits.
- Dev server on 127.0.0.1:3000 belongs to another session — probe only.

---

### Task 1: Request meter context + price resolution (the core)

**Files:**
- Create: `frontend/server/utils/requestMeter.ts`
- Test: `frontend/tests/unit/request-meter.unit.spec.ts`

**Interfaces (produced — later tasks consume these exactly):**
```ts
export interface MeterContext { userId: string; priceHintCredits?: number }
export function bindMeterContext(ctx: MeterContext): void            // auth middleware calls (enterWith)
export function currentMeterContext(): MeterContext | null           // chokepoints read
export function setMeterPriceHint(credits: number): void             // routes with route-level prices call AFTER bind
export class MeterRefusalError extends Error { statusCode: number; data?: unknown }
export function resolveCredits(model: string, hint?: number): number | null
  // MODEL_COSTS[model].credits, else hint, else LoRA category for personal
  // slugs (a slug whose owner segment is not a known public provider org),
  // else null. KNOWN_PUBLIC_ORGS = the org prefixes present in MODEL_COSTS
  // (derive from Object.keys at call time — never hardcode a second list).
export interface MeterTicket { settle(jobId: string): Promise<void> }
export function preflightMeter(model: string): Promise<MeterTicket | null>
  // local mode → null (no-op ticket). Hosted: resolve context (throw 500
  // MeterRefusalError 'unmetered spend refused' if absent), resolve credits
  // (throw 500 'unpriced model refused: <model>' if null), check
  // getAvailable >= credits (throw 402 MeterRefusalError with
  // { required, available }), and return a ticket whose settle(jobId)
  // debits credits with reason `provider:<model>` and idempotency key
  // `<jobId>` via getLiveLedger(). settle errors must LOG LOUDLY
  // ('[meter] DEBIT FAILED after successful job') and rethrow nothing —
  // a completed job's output must still reach the user.
```
Implementation notes: module-level `const als = new AsyncLocalStorage<MeterContext>()`; `bindMeterContext` uses `als.enterWith(ctx)` (per-request async chain in Nitro). Add `__setLedgerForTests(l)` seam (pattern: `__setClerkClientForTests` in auth.ts) so tests never need `DATABASE_URL`. `resolveCredits` for the LoRA category returns `LORA_RENDER_CREDITS` (import from priceBook); the RESTYLE price arrives via hint (Task 3), not slug-sniffing.

- [ ] **Step 1: failing tests** — cases: (a) local mode → `preflightMeter` returns null and never touches the ledger fake; (b) hosted no-context → throws 500 refusal; (c) hosted unpriced public-org slug (`'black-forest-labs/not-in-book'`) → throws 500 unpriced; (d) hosted personal slug (`'finnyjules/jules-jene'`) → LoRA category credits, preflight checks available, settle debits `(userId, 8, 'provider:finnyjules/jules-jene', 'fal:REQ1')`; (e) hosted priced slug with insufficient available → 402 with `{required, available}`; (f) hint overrides for unpriced slug; (g) settle ledger-throw → console.error spy called, no rethrow. Use `deployMode` control via env (`NUXT_CLERK_SECRET_KEY` set/cleared around cases — restore in `finally`, the userSync/auth tests show the pattern).
- [ ] **Step 2:** RED run (`npx vitest run tests/unit/request-meter.unit.spec.ts`).
- [ ] **Step 3:** implement per the interface block above.
- [ ] **Step 4:** GREEN run; also `npx vitest run tests/unit/price-book.unit.spec.ts` (you import from it — prove no breakage).
- [ ] **Step 5:** commit `feat(meter): request meter context + fail-closed price resolution` (files above only).

### Task 2: Chokepoint metering — runReplicate + runFal

**Files:**
- Modify: `frontend/server/utils/replicate.ts` (runReplicate)
- Modify: `frontend/server/utils/falRun.ts` (runFal)
- Test: `frontend/tests/unit/chokepoint-meter.unit.spec.ts`

**Interfaces:** consumes `preflightMeter` (Task 1). Wiring in BOTH functions: call `const ticket = await preflightMeter(model)` BEFORE the provider submit (so 402/refusals cost nothing); after confirmed success — the exact spot where `logSpend({... ok: true ...})` already fires — `if (ticket) await ticket.settle('rep:' + pred.id)` (Replicate) / `'fal:' + rid` (fal). No signature changes; no call-site changes. Failure paths (`ok:false` logSpend, throws, timeouts) never settle.

- [ ] **Step 1: failing tests** — mock `fetch` globally (fal/replicate HTTP) with canned submit/status/result responses; inject fake ledger via Task 1's seam; hosted-bound context: successful run settles exactly once with the right key; failed run (provider status failed) settles never; local mode: no ledger interaction and behavior identical (assert the mocked provider output round-trips). Follow the existing test files' global-stub patterns; `createError` used in replicate.ts is a Nitro auto-import — stub `globalThis.createError` like auth tests do.
- [ ] **Steps 2-4:** RED → implement → GREEN + run `tests/unit/pricing-display.unit.spec.ts` and any existing tests naming replicate/fal (`grep -rln "runReplicate\|runFal" tests/`).
- [ ] **Step 5:** probe local server (`curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/ai-status` → 200) and commit `feat(meter): meter provider chokepoints — preflight + debit-on-success`.

### Task 3: Bind context in auth middleware + route price hints

**Files:**
- Modify: `frontend/server/middleware/auth.ts` (attach branch: after `event.context.userId = decision.userId`, call `bindMeterContext({ userId: decision.userId })`)
- Modify: the Restyle route — find it: `grep -rln "RestyleWithLoRA\|restyle" frontend/server/api --include="*.ts"` — after auth, `setMeterPriceHint(RESTYLE_LORA_CREDITS)` with a comment naming the pricing decision.
- Test: extend `frontend/tests/unit/auth-middleware-helpers.unit.spec.ts` — after invoking the handler on a fake authed hosted event (established stub pattern), `currentMeterContext()?.userId === 'user_1'`.

- [ ] TDD steps as usual; also verify local no-op (`mode==='local'` returns before bind — context stays null). Commit `feat(meter): bind meter context at auth + restyle price hint`.

### Task 4: Bypass routes — lipsync, voice-clone, krea, covers

**Files:** `frontend/server/api/lipsync/speech.post.ts`, `frontend/server/api/voice-clone/start.post.ts`, `frontend/server/api/voice-clone/status.get.ts`, `frontend/server/api/krea/rewrite.post.ts`, `frontend/server/api/lora-cover.post.ts`, `frontend/server/api/replicate-cover.get.ts` + Test: `frontend/tests/unit/bypass-route-meter.unit.spec.ts`

Read each file FIRST and classify: does it create a paid provider job, or only fetch free metadata/images? For each **paid** call: `preflightMeter(<model-or-family-slug>)` before the provider call + `ticket?.settle('<family>:<job id>')` on success; if the slug isn't in MODEL_COSTS, ADD a row (usd from the file's own comments/estimator, credits per policy, `confidence: 'estimate'`) — never a hint for a knowable slug. For each **free** call: add a `// METER-EXEMPT: <reason>` comment — and add the same marker scan to the coverage test below. Lip-sync engines are per-second (engine-aware estimator exists in the client): price v1 as flat per-engine rows (`fabric-1.0` ≈ $0.75/5s → 113cr at 1.5×; kling ≈ $0.07/5s → 14cr at 2×) with a note that duration-aware pricing is a hardening rider.
- [ ] Include a **coverage test** in the new spec: walk `server/api` + `server/utils` for `api.replicate.com|fal.run|queue.fal.run` fetches and assert each containing file either imports `preflightMeter` or carries `METER-EXEMPT:` — the Stage-4 analogue of the price-book coverage scan. TDD: it must FAIL before your edits (that's its RED) and pass after.
- [ ] Commit `feat(meter): meter bypass routes — lipsync, voice-clone, krea, covers + coverage guard`.

### Task 5: Training family

**Files:** `frontend/server/utils/trainingProviders.ts` + the cloud-train routes that start paid work (read `frontend/server/api/cloud-train/start.post.ts` first; status/upload/caption/aesthetic/character-shot — classify paid vs free like Task 4) + Test: `frontend/tests/unit/training-meter.unit.spec.ts`

Training is the most expensive action (600cr, hardware-billed). Meter at the point a training JOB is created (`createReplicateProvider`'s start path or the route that calls it): preflight 600 (use `LoraTrainingNode`'s book parity — import the constant or add `TRAINING_CREDITS = 600` to priceBook with a no-comma comment), debit-on-successful-start keyed `train:<training id>` (start-success, not completion — hardware time is consumed regardless of final quality; note this policy in a comment). The queue runner (`server/plugins/trainingQueueRunner.ts`) runs OUTSIDE requests — no ALS. Thread userId explicitly: the queue REGISTRY records which user queued each job (read `server/utils/trainingQueue.ts` to find the record shape; add `userId?: string` if absent, captured at enqueue time from `event.context.userId`), and the runner passes it to a context-free meter variant: add `preflightMeterFor(userId, model, credits)` to requestMeter (same checks minus ALS). Local mode: enqueue path records no userId and the runner meters nothing.
- [ ] TDD with fake ledger; classify + exempt-mark the free cloud-train routes; commit `feat(meter): training runs debit 600cr at start`.

### Task 6: Anthropic assist family

**Files:**
- Create: `frontend/server/utils/anthropicMeter.ts` — `export const ANTHROPIC_ASSIST_CREDITS = 2` (no-comma comment: covers ~$0.01 median at 2×; flat because per-token metering is noise at this price) + `meterAssist(event: H3Event): Promise<void>` = hosted-only preflight+immediate debit keyed `assist:<crypto.randomUUID()>` reason `anthropic_assist` (immediate, not on-success: the call is cheap, sub-second, and the route structure varies; a failed call over-charges 2cr worst-case — note as accepted).
- Modify: every server file fetching `api.anthropic.com` (find them ALL: `grep -rln "api.anthropic.com" frontend/server --include="*.ts"`) — `await meterAssist(event)` after auth/rate-limit, before the fetch.
- Test: `frontend/tests/unit/anthropic-meter.unit.spec.ts` — meterAssist local no-op / hosted debit / 402; PLUS a coverage scan asserting every `api.anthropic.com` file references `meterAssist` (RED before edits).
- [ ] Commit `feat(meter): flat-rate metering on Anthropic assist routes`.

### Task 7: Live verification (CONTROLLER-EXECUTED — not a subagent)

- [ ] Hosted worktree server (established recipe; kill by lsof-discovery at teardown). Julien's wallet has ~9,000cr.
- [ ] **Cheapest real spend:** one real background-remover or flux-schnell call through a metered route (~1cr, <1¢ real) with Julien's session → assert a `provider:<slug>` debit keyed by the real job id lands in Neon and the wallet pill drops.
- [ ] **402 path free:** `ledger.debit` the test wallet down to ~1cr (admin key), attempt an expensive action → 402 `{required, available}`, nothing spent, wallet unchanged; then admin-credit the wallet back.
- [ ] **Local regression:** daily :3000 probes + one free local action unchanged.
- [ ] Record everything in `docs/superpowers/specs/2026-08-14-stage4-meter-verification.md`; commit.

---

## Self-review notes

- The 15 chokepoint call-site files need zero edits (ALS) — that's the point of Task 1/2's design; Task 4/6 coverage scans keep future bypass routes honest, mirroring the price-book and rate-limit guard patterns.
- Graph-route metering (`/api/meter/prompt`) already exists from Stage 1 and is untouched.
- Deliberately deferred (riders): duration-aware lip-sync pricing, hold/settle for long jobs, refund-on-training-hardware-failure, per-token Anthropic metering, client toast polish for 402s (the checkout-error banner pattern exists to copy).
- `enterWith` context-bleed risk: bound once per request in middleware on the request's own async chain; Nitro's own asyncContext feature uses the same primitive. If tests reveal bleed between sequential mocked requests, bind via `als.run()` wrapping in the middleware instead — note it in the task report.
