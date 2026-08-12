# Sailor → Consumer Product: Gap List & Roadmap

**Date:** 2026-08-11
**Status:** Roadmap (builds on `2026-07-01-accounts-credits-billing-design.md`, which remains the architecture spec)
**Scope:** Everything between today's codebase and a stranger being able to sign up, pay, and use Sailor safely.

## Plain-language summary

Sailor the *creative tool* is far along; Sailor the *product* is designed but not built. There is a full accounts/credits/billing design from July with locked decisions (Clerk for login, Neon Postgres for the database, prepaid Stripe credit packs, one CPU box, no self-hosted GPU), and the hardest technical unknown — metering ComfyUI graph runs — was spiked and proven. But every pillar of that design is currently a mock: auth is a plaintext header, the wallet is an in-memory Map, and the canvas iframe can bypass the meter entirely by talking to ComfyUI directly. Meanwhile ~35 server routes spend your personal Replicate/fal/Anthropic keys with no login, no metering, and (for the most expensive operations) no rate limiting — and the existing Fly deploy exposes the unauthenticated ComfyUI API on a public port.

The path is roughly 8 stages / 8–12 solo weeks: lock the doors (auth + private engine), build the real ledger, wire Stripe, meter the provider routes, meter the canvas + isolate tenants, move per-user data off the local filesystem, add safety guardrails and observability, then ship the launch surfaces (pricing page, landing page, ToS, onboarding) into a small private beta.

---

## Part 1 — Gap list

What exists today vs. what a consumer product needs. ✅ = built, 🟡 = designed/spiked but mocked, ❌ = nothing.

### A. Identity & access

| # | Gap | Today |
|---|-----|-------|
| 1 | 🟡 **Authentication** (signup / login / sessions) | None. Only `server/utils/spikeAuth.ts` — a plaintext `x-spike-user` header stub. Spec decision: Clerk. No `app/middleware/` exists at all. |
| 2 | 🟡 **User model + database** | No Postgres. All persistence is flat JSON files with no owner. Spec decision: Neon. |
| 3 | ❌ **Route guards** | ~35 money-spending Nitro routes and the entire ComfyUI proxy are unauthenticated. |

### B. Money

| # | Gap | Today |
|---|-----|-------|
| 4 | 🟡 **Wallet + ledger** | `mockLedger.ts` — in-memory Map, shaped for the Postgres swap. Spec: append-only double-entry. |
| 5 | ❌ **Payments** | No Stripe anywhere. Spec: Checkout credit packs, webhook-only granting. |
| 6 | 🟡 **Price book** | `priceBook.ts` exists (`spike-v1`, 1 credit = $0.01). Pack sizes + real exchange rate undecided (spec open question #3). |
| 7 | ❌ **Metering Surface A** (direct provider routes) | Zero. LoRA training — the most expensive action in the product — has no metering *and* no rate limit. Only 7 Anthropic routes have a 30/min in-memory limiter. |
| 8 | 🟡 **Metering Surface B** (graph runs) | `/api/meter/prompt` spiked and live-verified 2026-07-03, but optional — the canvas iframe submits straight to `:8188`, bypassing it. |

### C. Security & isolation

| # | Gap | Today |
|---|-----|-------|
| 9 | ❌ **Engine privacy** | `fly.toml` exposes unauthenticated ComfyUI on public `:8188` (it's the iframe origin). Anyone can queue prompts and read every generated file on the deployed box. |
| 10 | 🟡 **Multi-tenant engine isolation** | ComfyUI's `/history`, `/view`, `/interrupt` are global; one shared `input/`. Worker pool (`comfyWorkerPool.ts`, ports 8189+) already exists; ownership filtering does not. Spec §6.5 designs this; launch blocker for any second user. |
| 11 | ❌ **Moderation** (prompt-side + output-side) | None. One abuser can get the shared provider account banned. Spec §8 launch blocker. Output-side classifier choice is open question #2. |
| 12 | ❌ **Abuse limits** | No velocity limits, no per-user spend caps, no provider daily ceilings, no Stripe Radar config. |
| 13 | ❌ **Secrets hygiene** | Live keys sit in `frontend/.env`; `falStorage.ts` reads raw `process.env` bypassing runtimeConfig; Python nodes parse `frontend/.env` off disk; a per-browser Anthropic key is sent per-request from the client. Needs one server-only path. |

### D. Data & storage

| # | Gap | Today |
|---|-----|-------|
| 14 | ❌ **Per-user persistence** | Projects live in ComfyUI's user dir (`nodes_sailor_projects.py`); brand kits / moodboards / templates are JSON written *into the source tree*; LoRA + character metadata are filesystem sidecars. Nothing has an owner column. |
| 15 | ❌ **Object storage** | No S3/R2 anywhere. 11.6 GB of live `input/` + `output/` on local disk (one Fly volume on the deploy). Spec assumes R2 for outputs (§6.5.3). |
| 16 | ❌ **Backups** | None beyond the Fly volume. The ledger especially needs point-in-time recovery (Neon provides it — one more reason to land Postgres early). |

### E. Product surfaces (user-facing)

| # | Gap | Today |
|---|-----|-------|
| 17 | ❌ **Auth pages** (sign-up/in/reset) | Clerk components + thin wrappers. `UserPopup.vue` is a shell to hang account UI on. |
| 18 | ❌ **Wallet page** (balance, packs, history) + checkout return pages | Spec §9.1. |
| 19 | ❌ **Paywall states in the canvas** | "Costs N credits" affordance on every run entry point (node Play, studio Render cascade, training enqueue) + insufficient-credits → top-up flow. Touches many surfaces; the widest UI item. |
| 20 | ❌ **Cost transparency** | Spend log exists (`spend.jsonl` + `/sailor/spend/summary`) but is observational; per-run settled cost isn't shown in results. |
| 21 | ❌ **Pricing page + onboarding** | What actions cost, pack pricing, signup-bonus explainer, first-run tour. |
| 22 | ❌ **Landing page / marketing site** | Nothing exists. Also no sharing/export-to-community story (named risk in `docs/ROADMAP.md` Act 3). |

### F. Operations

| # | Gap | Today |
|---|-----|-------|
| 23 | ❌ **Analytics + error reporting** | No Sentry, no PostHog/Plausible — zero visibility into a hosted user's session. Errors go to console + toasts. |
| 24 | 🟡 **Admin surfaces** | Spec §9.2: user lookup + manual credit grant (needed in the ledger phase — it's how you test it), reconciliation report, ban/freeze. Vendor dashboards cover the rest. |
| 25 | ❌ **Reconciliation** | Nightly `provider_usage` vs ledger cron + drift alerts (spec §8). |
| 26 | 🟡 **Deployment pipeline** | Dockerfile + fly.toml exist (single container, both processes, dies together). No deploy CI, no staging, no env separation, docs/STATE.md still says "no deploy config". |
| 27 | ❌ **Legal** | ToS (credit expiry ~12 mo, repriceable costs — the spec depends on these clauses), privacy policy, content policy. Receipts/auth emails are vendor (Stripe/Clerk) at launch. |

### G. Business decisions (not code)

| # | Gap | Today |
|---|-----|-------|
| 28 | ❌ **Pricing call** | Credit-pack sizes + credit↔$ rate (blocks Stripe phase). Spec suggests 1.5–2× blended markup. |
| 29 | ❌ **Demand validation** | VISION.md: "the willing-to-pay segment is not yet isolated… the next real input is primary — five practitioners, watched." The private beta at the end of this roadmap *is* that instrument. |

---

## Part 2 — Roadmap

The July spec's build order (§10) is the spine; this wraps it with the gaps the spec left out (object storage, per-user data migration, observability, launch surfaces). Stages are sequential where they share state; a few can overlap.

**Already done (Stage 0):** compute topology decided (CPU box + operator API keys, no GPU hosting for v1) · Surface-B metering spike live-verified · price book v1 · mock ledger shaped for the Postgres swap · worker pool built · Fly deploy exists (Dockerfile, fly.toml, volume).

### Stage 1 — Lock the doors *(~1 wk)* — spec Phase 1
The app gets an owner. Nothing about money yet.
- Neon Postgres + schema (users, wallets, ledger_entries, holds, price_book, stripe_customers, provider_usage).
- Clerk: sign-up/in/reset pages, session cookie, `server/middleware/auth.ts` verifying the JWT on every `/api/**` **and every proxied ComfyUI path**, user-sync webhook + lazy get-or-create.
- **The deployment switch:** no Clerk keys in env ⇒ local mode — no login, meter off, exactly today's behavior. This keeps Julien's daily dev/personal use friction-free and is non-negotiable.
- **Immediately:** bind `:8188` to a private interface on Fly (it is publicly exposed today). The iframe origin moves behind the proxy in Stage 5; until then hosted deploys are operator-only.
- Secrets cleanup (gap 13): all provider keys through runtimeConfig, kill the client-supplied Anthropic key path in hosted mode, stop Python parsing `.env`.

### Stage 2 — Money core *(~1–1.5 wk)* — spec Phase 2
- Real `ledger.ts`: append-only double-entry, `SELECT … FOR UPDATE`, idempotency keys, hold/settle/release. Swap target already shaped by `mockLedger.ts`.
- Wallet UI (balance + transaction history), signup bonus on user-created.
- Admin: user lookup + manual grant/clawback (this is how the ledger gets tested before Stripe exists).

### Stage 3 — Charge *(~1 wk)* — spec Phase 3
- **Decide pricing first** (gap 28): pack sizes, credit↔$ rate, markup.
- Stripe Checkout for packs; signature-verified webhook is the *sole* credit-granting path; refund/dispute clawback; Radar + top-up velocity limits.
- Pricing page (static) + checkout return pages.

### Stage 4 — Meter the provider routes *(~1–2 wk)* — spec Phase 4
- Wrap all ~35 fal/Replicate/Anthropic routes: preflight available balance → run → debit on success. Hold-then-settle for variable-cost jobs (training by steps, video by seconds) — extends the existing durable training queue states.
- Paywall UI states (gap 19): "costs N credits" on run entry points, insufficient-credits → top-up interruption, settled cost shown per result (gap 20 — wire the existing spend.jsonl view into real per-user data).
- After this stage the wallet is real for everything *except* canvas graph runs.

### Stage 5 — Meter the canvas + isolate tenants *(~2–3 wk)* — spec Phases 5 + 5.5, the concentrated risk
- All iframe/ws/HTTP ComfyUI traffic through the authed Nitro proxy; `:8188`+workers private; ws proxy is the hard part (~1 wk sized by the spike).
- Surface B live: every prompt priced via `/api/meter/prompt`, debit on success by `prompt_id`, no charge on failure. Legacy comfy.org key pass-through per spec §7.
- Multi-tenancy (spec §6.5): meter routes jobs to the existing worker pool; ownership map filters `/history`, `/view`, `/interrupt` (unowned id → 404); per-user `input/` prefixes; outputs pushed to **R2** (gap 15 starts here — new generations first).
- **This stage is the launch blocker for any second user.**

### Stage 6 — Per-user data *(~1–2 wk)* — not in the July spec
- Migrate ownerless stores to Postgres (metadata) + R2 (blobs), keyed by user: projects/versions/generations (out of ComfyUI's user dir), brand kits, moodboards, template layouts, characters, house styles, LoRA metadata.
- Keep the local-mode switch: filesystem backends remain when Clerk keys are absent — same interface, two drivers.
- Backups: Neon PITR + R2 versioning; test a restore once.

### Stage 7 — Guardrails & observability *(~1–2 wk, then ongoing)* — spec Phase 6, widened
- Prompt-side moderation before any provider call; output-side moderation (classifier choice = open question, needs its own design pass).
- Per-user velocity/spend caps; hard daily provider ceilings; alerting.
- Nightly reconciliation cron (`provider_usage` vs ledger) + drift alerts.
- Sentry (server + client) and privacy-light product analytics (gap 23) — flip on in hosted mode only.

### Stage 8 — Launch surfaces & private beta *(~1–2 wk)*
- Landing page, onboarding (signup-bonus notice, what credits are), moderation-feedback states, ToS + privacy + content policy (credit expiry, repriceable costs).
- **Private beta: the five watched practitioners from VISION.md.** This closes gap 29 — the beta is the demand-validation instrument, not just a QA pass. Instrument it (Stage 7 analytics) so "control > quality" gets measured, not assumed.

### Explicitly out of scope for launch (per spec §11)
Subscriptions/auto-top-up, teams/seats, multi-currency, referrals, polished admin dashboard, self-hosted GPU (returns as a COGS lever at ~1,500 flux-class images/day utilization).

### Sizing
~9–13 solo weeks of build across Stages 1–8. The two lumps of genuine risk: the ws/iframe proxy (Stage 5) and output-side moderation (Stage 7). Everything else is well-trodden vendor integration or migrations of stores that already have clean interfaces.

### Dependency notes
- Stages 1→2→3 are strictly sequential (identity → ledger → payments).
- Stage 4 can start once Stage 2 lands (metering needs the ledger, not Stripe).
- Stage 6 can overlap Stages 4–5 (different files).
- Stage 8's legal/landing work can overlap anything.
