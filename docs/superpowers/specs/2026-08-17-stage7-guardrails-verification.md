# Stage 7 — guardrails & observability: verification record + operator checklist

**Plain summary:** four hosted-only safety nets for the beta, all off in local mode. (1) A prompt safety check before any paid generation (OpenAI moderation, fail-open) so a ToS-violating prompt can't get the shared provider account banned. (2) Error alerts (Sentry) so a beta failure reaches you instead of dying silently. (3) An emergency brake — a global kill-switch, per-user disable, and a daily credit-spend ceiling — the one thing prepaid credits don't cover (a *bug* over-dispatching). (4) A nightly spend digest that surfaces the day's spend and flags any provider charge with no matching wallet debit. Metering (Stages 4–6) already bounds per-*user* budget, so this stage is deliberately small. Every feature is inert without its env key; local `:3000` is byte-identical.

## What the stage built (7 code commits + a 3-fix wave; base 19526250b)

- **Prompt-side moderation** (`moderation.ts`, `graphPromptText.ts`) at the two metering chokepoints — the canvas graph submission (before any hold, so a refusal costs nothing) and the Nitro provider routes (`runReplicate`/`runFal`, after the ticket, releasing it on refusal). Fails OPEN on any OpenAI error/timeout (a moderation blip must not freeze generation for a watched beta) — recorded decision. No `OPENAI_API_KEY` → no-op. Image-only calls send nothing (data-URL/long values skipped — no image bytes to OpenAI).
- **Operator safety valves** (`systemControls.ts`, `/api/admin/controls`): a global `paused` flag + per-user `disabled` set + a daily credit-spend ceiling (`SAILOR_DAILY_CREDIT_CEILING`), all checked BEFORE the hold on **both** spend surfaces — the provider preflight (`preflightForUser`) AND the canvas-graph chokepoint (`meterGraphSubmit`) AND the anthropic-assist debit. Fails CLOSED (an unreadable control state pauses spend — opposite of moderation, because an unknown spend state is a money risk). The ceiling sums today's ledger DEBIT credits (complete across all surfaces, `reason='expiry'` excluded), NOT `provider_usage` (which is Nitro-route-only). Kill-switch is immediate; the ceiling backstop lags ≤30s (a hot-path memo). Admin routes self-guard on `ADMIN_CLERK_USER_ID` (unset ⇒ 404 for everyone).
- **Provider-spend recording** (`providerUsage.ts`): confirmed direct-route spend lands in the `provider_usage` Neon table (was never written before), keyed `job_id = settle:<holdId>` to match the ledger debit for the reconcile join.
- **Nightly reconciliation digest** (`reconcile.ts` + cron plugin, holdSweep pattern): logs the day's total credits charged (complete, from the ledger) + per-provider USD (direct-route detail) + flags any `provider_usage` row with no matching ledger debit. Never blocks boot; local → nothing scheduled.
- **Sentry** (`observe.ts`, `plugins/sentry.ts`, `@sentry/nuxt` client): error capture at the money/engine chokepoints, hosted-only via DSN, prompt text scrubbed. No DSN → fully inert (verified: no init, no client module, byte-identical local boot).

**Blockers the final review caught before it was called done:** the spend guard covered only `preflightForUser`, MISSING the canvas-graph chokepoint (the biggest spend surface) + the anthropic-assist debit — the recurring "canvas graphs bypass the Nitro chokepoint" two-surface trap; and five hosted unit specs were silently passing only because `DATABASE_URL` leaked into the test env (they queried live Neon) — now all inject a no-op guard seam and the family is green with `DATABASE_URL` unset.

## VERIFIED automated (2026-08-17)

- Hosted `:3100` (fresh boot, no Stage-7 env keys present in `.env.hosted` yet → each feature inert): `/api/wallet`, `/api/admin/controls`, `POST /prompt` all → 401 unauthenticated; boot clean (Sentry skipped — no DSN; reconcile cron fired: `[reconcile] daily digest {chargedCredits:0,...}`); no resolve warnings (the new Sentry module resolves cleanly).
- Local `:3000` regression: `{"mode":"local"}` wallet; `/api/admin/controls` unchanged (404, no new 500); no Sentry init / no reconcile cron / no resolve warnings — byte-identical.
- **Clean-env unit sweep** (`env -u DATABASE_URL`, twice): meter + Stage-7 family **15 files / 247 tests green** — unit tests no longer touch live Neon.
- Evidence: `.superpowers/sdd/stage7-probes.md`; final review: `.superpowers/sdd/stage7-final-review.md`.

## To actually exercise Stage 7 (needs the env keys — add to `.env.hosted`)

None of the four features do anything until their key is set — that's the local-safe design. To turn them on for the beta:
- `OPENAI_API_KEY` → prompt moderation active.
- `SENTRY_DSN` (+ `NUXT_PUBLIC_SENTRY_DSN` for the client) → error alerts.
- `SAILOR_DAILY_CREDIT_CEILING` (integer, e.g. 50000) → the daily brake; unset/0 = no ceiling.
- `ADMIN_CLERK_USER_ID` (your Clerk id) → the `/api/admin/controls` kill-switch route.

## Julien's checklist (hosted `:3100`, once the keys are set)

1. **Kill-switch:** `POST /api/admin/controls {"globalPaused": true}` (as the admin) → the next generation returns "Sailor is temporarily paused", nothing charged. `{"globalPaused": false}` → works again.
2. **Ceiling:** set `SAILOR_DAILY_CREDIT_CEILING=1`, run one generation → the next is paused (day's debits ≥ 1).
3. **Moderation:** submit an obviously-violating prompt → blocked, nothing charged; a normal prompt → runs.
4. **Sentry:** confirm the DSN'd project receives events (trigger any handled error).
5. **Digest:** check the server log for `[reconcile] daily digest` after the nightly run (or the ~60s-after-boot run).

## Fail directions (the deliberate split)

Moderation fails **OPEN** (OpenAI down → allow + Sentry alert): a moderation blip must not take generation down for a watched beta. Spend controls fail **CLOSED** (control read error → pause): an unknown spend state is a money risk. Opposite on purpose.

## Deferred / riders

- **Deferred (design):** output-side (image) moderation, rich product analytics, Stripe Radar — beta-unnecessary; revisit before public launch.
- **Riders:** `provider_usage` is Nitro-route-only (training/canvas/bypass spend absent from the per-provider digest breakdown — the ledger TOTAL is complete; widen coverage pre-public-launch if the breakdown matters); moderation gates on `OPENAI_API_KEY` presence only (a local box exporting that var would moderate — add an `isHosted()` check); `disableUser` of a never-signed-in id → FK 500; 30s ceiling memo staleness; `observe.ts` static-imports `@sentry/node` (runtime-inert, ~261ms local boot — lazy import cleaner); scrub is top-level-only (keep captureError context flat).

## Teardown

Hosted `:3100`: kill via open-file discovery — `for p in $(lsof -nP | awk '/sailor-meter-verify/ {print $2}' | sort -u); do kill $p; done`.
