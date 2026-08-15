# Stage 4 metering — verification record + operator checklist

**Plain summary:** every route that spends provider money now checks and charges the user's wallet in hosted mode, and refuses to spend anything it can't price or attribute. The automated legs are verified below against a live hosted server; two legs need Julien's signed-in session (~2 minutes) and are listed at the bottom. Local mode is untouched — no checks, no charges.

## What the stage built (7 tasks, all reviewed; final whole-branch verdict READY)

- **The meter core** (`requestMeter.ts`): request-scoped identity via AsyncLocalStorage (the context-box pattern — the naive approach provably didn't propagate; empirically pinned with a real-h3 integration test), fail-closed price resolution (booked slug → explicit LoRA-owner allowlist → hint → REFUSE), preflight + debit-on-success tickets keyed by provider job ids.
- **Chokepoints**: `runReplicate`/`runFal` meter every one of their ~15 calling routes with zero call-site changes; refusals cost nothing (proven: no HTTP before preflight).
- **Bypass routes**: lipsync/voice-clone/krea/covers classified paid-or-exempt with a coverage-guard test that fails on any future unmarked provider fetch. Voice-clone settles on confirmed success in the status poll — with ownership binding, so only the starter's wallet is ever charged.
- **Training** (600cr): debits at successful job start; the queue runner charges via explicit userId threaded through the persisted job record; hosted jobs without an owner FAIL VISIBLY instead of running free (mode-based guard — JSON drops undefined keys, so key-presence checks were insufficient).
- **Anthropic assists**: flat 2cr on all 10 `api.anthropic.com` routes, with its own coverage guard.
- **402s are real**: `MeterRefusalError` carries h3's error duck-shape, so clients receive `{statusCode: 402, message, data: {required, available}}` — empirically traced through Nitro's production error handler.

**Money bugs caught by review before any user could hit them:** voice-clone charged at creation (now: on success), owner-less persisted training jobs ran free (now: fail closed), settle-charges-whoever-polls (now: owner-bound), 402 bodies were being sanitized to "Server Error" (now: full shape).

## VERIFIED automated (2026-08-15 00:42, hosted worktree at 4bbeef3ad on :3100)

- Boot: fresh listener (pid age 9s), no resolve warnings.
- Unauthed guard on metered routes: `/api/copy-assist`, `/api/lipsync/speech`, `/api/training-queue` all → 401.
- Local :3000 regression: `{"mode":"local"}`, app untouched.
- Suites: 95 tests across the five meter suites, twice; plus per-task RED-proven coverage guards.

## Julien's 2-minute checklist (needs your signed-in session; server left running on :3100)

1. **The 1-cent proof:** open :3100, sign in, run the CHEAPEST real action (background-remove an image — 1cr) → wallet pill drops by 1; Neon gains a `provider:851-labs/background-remover` debit keyed `rep:<id>`. (This is the only real money in the whole verification: <1¢.)
2. **The 402 (free):** tell Claude to run it — we admin-debit your test wallet to ~1cr, you attempt an expensive action (any video/3D), you should see a clean insufficient-credits error naming required vs available, nothing charged; wallet restored after.

## Hardening riders (carried, priority-ordered)

1. **No-hold parallel-preflight leak (exploitable):** N parallel expensive actions preflight against the same balance; overshooting settles fail loudly but outputs ship. Fix = hold/settle for multi-call routes (the ledger already supports holds).
2. Voice queue-route key divergence (`train:` vs `rep:` for the same job) — block voice on the queue route or unify.
3. Lipsync text-length cap (flat 6cr vs unbounded chars).
4. Anthropic coverage scan roots (api/ only today; add utils/).
5. Stage-5: result-disclosure authz (non-owners can read status), durable voice-clone ownership.
6. Dead `setMeterPriceHint` (no production caller — remove or keep for Stage-5 per-user pricing).

## Teardown

Kill by open-file discovery (`for p in $(lsof -nP | awk '/sailor-meter-verify/ {print $2}' | sort -u); do kill $p; done`), then `git worktree remove --force /private/tmp/claude-501/sailor-meter-verify`.
