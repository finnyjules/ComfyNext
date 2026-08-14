# Stripe test-mode verification — run-book + results

**Plain summary:** Stripe's signed webhooks were fired at a real hosted Sailor server and the money landed in (and left) the real Neon ledger correctly: a Creator-pack purchase granted exactly 2,750 credits once (a replayed delivery granted nothing), and refunds clawed credits back — including the partial-shortfall path, live. Two real bugs were found and fixed by doing this live: an auth-middleware deadlock on webhook bodies, and Stripe's current API not embedding itemized refunds. One item is blocked on a bad paste: the `sk_test_` key in `.env.hosted` is invalid (128 chars — should be ~107), which blocks the checkout-session route and the itemized-refund fetch until re-pasted.

## Setup used (repeatable)

1. Worktree server (NEVER a second dev server in the main checkout — and NEVER `pnpm add/install` in the main checkout while both run; see the phantom-export outage):
   `git worktree add --detach /private/tmp/claude-501/sailor-stripe-verify HEAD && ln -s <main>/frontend/node_modules <worktree>/frontend/node_modules`
   Boot: `cd <worktree>/frontend && env $(grep -vE '^#|^$' <main>/frontend/.env.hosted | xargs) ./node_modules/.bin/nuxt dev --port 3100`
2. Forwarder: `stripe listen --forward-to 127.0.0.1:3100/api/webhooks/stripe` (get `whsec_` once via `stripe listen --print-secret` — NOTE: `--print-secret` prints and EXITS; run the persistent listen separately). Secret stored as `STRIPE_WEBHOOK_SECRET` in `.env.hosted`.
3. Grant events with real metadata, no browser needed:
   `stripe trigger checkout.session.completed --override "checkout_session:metadata[userId]=<id>" --override "checkout_session:metadata[packId]=creator" --override "checkout_session:metadata[credits]=2750"`

## VERIFIED (2026-08-13 21:0x–21:3x, all against live Neon)

- **Signature gate:** unsigned POST → 400; missing-secret would 500 (secret present).
- **Auth guard vs webhooks:** public paths short-circuit before session resolution — this was BROKEN (deadlock: Clerk's `toWebRequest` wrapped the body every request; `readRawBody` then hung; every forwarder delivery timed out). Fixed in `59afa6bab`, verified live.
- **Grant:** `checkout.session.completed` (paid, Creator metadata) → wallet 200 → 2,950; exactly one `pack_purchase:creator|2750` ledger row keyed by the event id.
- **Idempotency:** `stripe events resend <same evt>` → 200, balance unchanged, still exactly 1 row for that key.
- **Refund clawback (single):** $5.00 refund on a mapped customer → `refund_clawback|500` debit, wallet 2,950 → 2,450.
- **Shortfall path:** refund larger than available → debit capped at available, `[stripe] REFUND CLAWBACK SHORTFALL` logged loudly, action `clawback_partial`. Observed live.
- **Fetch-failure fallback:** with a broken API key, `[stripe] REFUND LIST FETCH FAILED` logged (twice) and the documented cumulative fallback ran — loud, never silent.

## FOUND + FIXED during this run

1. `fix(auth) 59afa6bab` — public-path body-stream deadlock (above). The Stage 1 smoke could not have caught it (no signed-body POST to a public path existed before Stripe).
2. `fix(billing) 88669c4ab` — **current Stripe API versions do NOT embed `refunds.data` on the charge**, so the multi-partial-refund-safe path never ran; the handler now fetches itemized refunds via `stripe.refunds.list` (dep-injected), keeping debits keyed by `re_` ids. Unit-proven (10/10); live proof pending the key fix below.

## BLOCKED on operator action

- **`STRIPE_SECRET_KEY` in `frontend/.env.hosted` is invalid** (length 128 — a real `sk_test_` is ~107; Stripe rejects it). Until re-pasted correctly: the checkout-session route (`/api/billing/checkout`) and the itemized-refund fetch cannot run live. Re-copy from dashboard.stripe.com → Developers → API keys (test mode) and replace the line.

## Remaining live checks (after key fix)

1. Re-run the two-partial-refund scenario → debits keyed by `re_` ids, second refund claws only its own delta.
2. `POST /api/billing/checkout` (signed-in browser) → Stripe-hosted page → test card `4242 4242 4242 4242` → redirect + wallet bump. (Julien click-through; the webhook leg is already proven.)
3. Browser look at the /account buy-credits section (framing rules).

## Test-wallet bookkeeping

The pre-fix runs over-clawed the test wallet to 0 (old cumulative code — exactly the bug the fix addresses; kept in ledger history deliberately as evidence). Restored via a proper ledger credit: `admin_grant:test-wallet-reset|2450` keyed `admin:reset-overclawed-testing-1`. Balance at close: **2,450**.

## Teardown

`pkill` is NOT sufficient for the worktree server (node children's argv lacks the worktree path — this bit us twice; a stale pre-fix server silently kept port 3100 while the "new" one took another port). Kill by open-file discovery:
`for p in $(lsof -nP | awk '/sailor-stripe-verify/ {print $2}' | sort -u); do kill $p; done`
then `git worktree remove --force /private/tmp/claude-501/sailor-stripe-verify`. The forwarder is a background `stripe listen` — kill it the same way (`pgrep -fl "stripe listen"`).
