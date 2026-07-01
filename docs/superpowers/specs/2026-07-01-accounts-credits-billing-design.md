# User Accounts + Credits/Billing System — Design Spec

**Date:** 2026-07-01
**Status:** Draft for review
**Scope:** Identity, wallet/ledger, payments, and metering for ComfyNext as a hosted multi-tenant SaaS. Fully independent from ComfyUI's native comfy.org account/credit system.

## 1. Goal & context

ComfyNext becomes a hosted product: users sign up, buy prepaid credits, and every action they take (generation, training, cloud model calls) draws down their wallet. ComfyUI is the hidden execution engine on our GPUs — users never see it, and there is no "local free tier"; the free tier is a signup credit grant.

Monetization strategy (already decided, 2026-06-09): prepaid wallet, Stripe Checkout top-ups, no subscription at launch. One aggregate Replicate/Anthropic account operator-side; user credits are an internal ledger. Internal credit unit abstracts provider pricing; ~1.5–2× blended markup absorbs fraud, failed runs, Stripe fees, and GPU-cost variance.

Current codebase reality this builds on:
- No accounts, no auth, no database. Persistence is JSON files (`.data/`, models dir).
- All paid provider calls already funnel through the Nitro backend (`server/utils/replicate.ts`, `server/utils/secrets.ts` — one app-global token).
- ComfyUI HTTP traffic is proxied by `server/middleware/comfyui-proxy.ts` (forwards `/prompt`, `/queue`, etc.), **but the canvas iframe currently talks to `:8188` directly** — see §6 precondition.
- Durable job pattern exists: `server/utils/trainingQueue.ts` + `server/plugins/trainingQueue.ts` (JSON registry + Nitro-plugin runner).

## 2. Decisions locked

| Decision | Choice |
|---|---|
| Deployment model | Hosted multi-tenant SaaS |
| Identity | **Clerk** (managed). We store only their `user_id` as FK; Clerk owns auth flows, OAuth, reset, MFA |
| Database | Managed Postgres (lean **Neon**). Required: the ledger needs ACID transactions; JSON files cannot do atomic check-and-debit |
| Ledger design | **Append-only double-entry**; cached balance on wallet as a performance copy, always rebuildable from the log |
| Pricing model | **Fixed credit price per action/output type** (from a versioned `price_book`), not metered GPU-time. Operator absorbs GPU variance via markup |
| Debit timing | Debit-on-success for fixed-price actions (incl. normal graph runs). Hold-then-settle only for variable-provider-cost jobs (video by output-seconds, LoRA training by steps) |
| ComfyUI native credits | Independent by construction; legacy API nodes allowed via **user's own comfy.org key, pass-through only** (§7) |
| Payments | Stripe Checkout for credit packs; webhook is the sole credit-granting path |

## 3. Architecture

```
Browser ──► Nuxt/Nitro server ──► ComfyUI engine (:8188, network-private)
             │                └──► Provider proxies (Replicate / Anthropic)
             ├─► Clerk      (identity: signup/login/sessions/OAuth)
             ├─► Postgres   (users mirror, wallets, ledger, holds, price book, stripe map)
             └─► Stripe     (Checkout top-ups + webhooks)
```

The meter has **two surfaces**, both clamped onto existing choke points:
- **Surface A — provider proxies:** Replicate/Anthropic calls and the training queue. Choke point already exists.
- **Surface B — ComfyUI graph runs:** every prompt submission goes through the authenticated Nitro proxy, which prices the graph (per-action from `price_book`), checks the wallet, forwards to Comfy, and debits on the `executed`/`execution_success` ws event for that `prompt_id`. Failed/crashed runs are never charged.

## 4. Data model (Postgres)

| Table | Purpose |
|---|---|
| `users` | Mirror of Clerk (id, email, created_at). FK anchor. Populated by Clerk webhook **and** lazy get-or-create on first authenticated request (webhooks can lag) |
| `wallets` | One per user: cached `balance_credits` **and `reserved_credits`** (sum of open holds). Available = balance − reserved. Only `ledger.ts` writes these |
| `ledger_entries` | Append-only, immutable. Every credit/debit: +top-up, −generation, −training, +refund, +signup bonus, −clawback. Each row records the `price_book` version that priced it and an idempotency key |
| `holds` | Pending debits for variable-cost jobs. Reserve at start → settle(actual) or release on completion webhook |
| `price_book` | action → credit cost, versioned. Reprice without migration; ToS declares costs repriceable |
| `stripe_customers` | user ↔ Stripe customer / payment mapping |
| `provider_usage` | Raw provider cost per job, for nightly reconciliation |

**Correctness invariants:**
- Every balance-affecting write goes through `server/utils/ledger.ts`, inside a transaction with `SELECT … FOR UPDATE` on the wallet row.
- Every credit/debit carries an idempotency key (job id, Stripe event id, prompt id) — retried webhooks and double-clicks never double-charge.
- Preflight checks **available** balance (balance − reserved), not raw balance, so concurrent holds cannot overspend.

## 5. Subsystems

### 5.1 Identity sync (Clerk → DB)
- Clerk Nuxt SDK: sign-in/up/reset pages, session cookie, route guard.
- `server/middleware/auth.ts`: verifies the Clerk session JWT on every `/api/**` **and every proxied ComfyUI path**, attaches `event.context.userId`. Runs before `comfyui-proxy.ts`.
- `server/api/webhooks/clerk.post.ts`: on `user.created` → insert user + create wallet + post signup-bonus ledger entry, one transaction. Lazy get-or-create fallback covers webhook lag (idempotent).

### 5.2 Ledger (`server/utils/ledger.ts` — the money core)
- `getBalance(userId)` / `getAvailable(userId)`
- `credit(userId, amount, reason, idempotencyKey)`
- `debit(userId, amount, reason, idempotencyKey)` — rejects on insufficient available balance
- `hold(userId, estimate)` / `settle(holdId, actual)` / `release(holdId)`
- Nothing else writes `ledger_entries` or wallet columns. Pure module, unit-testable against a test DB.

### 5.3 Stripe (`server/api/billing/*` + webhook)
- `POST /api/billing/checkout`: create Checkout session for a credit pack, map/create `stripe_customer`, return redirect URL.
- `server/api/webhooks/stripe.post.ts`: signature-verified; on `checkout.session.completed` → `ledger.credit(...)` keyed by Stripe event id. The browser's success redirect never grants credits.
- `charge.refunded` / dispute events → negative ledger entry (clawback). Stripe Radar + top-up velocity limits enabled.

### 5.4 Metering
- **Surface A:** wrap provider proxies and the training-queue lifecycle: preflight → (hold for variable-cost) → run → debit/settle. Training holds on enqueue, settles on finalize — extends the existing durable-queue states.
- **Surface B:** prompt submissions routed through the authenticated proxy; graph recognized → priced per action from `price_book` → available-balance check → forward → debit on success event correlated by `prompt_id`. No charge on failure.

## 6. Precondition: engine isolation (security-critical)

Today the canvas iframe loads from and submits prompts directly to `:8188`, bypassing the Nitro proxy (`comfyui-proxy.ts` header comment confirms). In the hosted deployment this is a **billing bypass and tenant-isolation hole**. Required before Surface B ships:

1. `:8188` bound to a private network interface — unreachable from the public internet.
2. All iframe/ws/HTTP ComfyUI traffic forced through the Nitro proxy.
3. The proxy enforces the Clerk session (via §5.1 middleware) on every forwarded request.

## 7. Relationship to ComfyUI's native credit system

The two systems are independent **by construction**: comfy.org credentials travel only as `auth_token_comfy_org` / `api_key_comfy_org` inside prompt `extra_data` (`execution.py:151`) and are read only by `comfy_api_nodes/*`. Our system lives entirely in the Nuxt/Postgres/Stripe layer. No shared identifiers, processes, or stores.

**Policy for legacy API nodes (decided: pass-through):**
- Users MAY run legacy comfy.org API nodes using **their own** comfy.org API key.
- The key is supplied by the user, attached to their prompt submissions, and **passed through — never stored server-side**. The proxy strips any such credential it did not receive from that user's own session.
- Provider cost for those nodes bills the user's comfy.org account, **zero ComfyNext credits** for the API-node portion; the GPU execution of the surrounding graph is still priced normally per §5.4.
- UI labels these nodes "legacy"; they are not promoted anywhere.
- **Hard rule:** no operator comfy.org credential ever exists in the hosted deployment — otherwise every tenant could spend it.

## 8. Guardrails

| Guardrail | When | Notes |
|---|---|---|
| Moderation gate — prompt-side | Launch-blocker | Check before any provider call; one abuser can get the aggregate provider account banned |
| Moderation — output-side | Launch-blocker | Image/video results moderated too; arbitrary graph output is harder than single-call moderation — needs its own design pass |
| Velocity limits + Stripe Radar | Launch-blocker | Per-user caps on spend and top-ups; chargeback fraud is the main loss vector |
| Nightly reconciliation | Launch | Nitro-plugin cron (same pattern as `trainingQueue.ts`): `provider_usage` vs ledger debits, alert on drift |
| Provider spend alerts | Launch | Hard daily ceiling on Replicate/Anthropic spend |
| ToS terms | Launch | Credit expiry (~12 mo), repriceable action costs |

## 9. Frontend

- Auth pages (Clerk components) + route guard.
- Wallet: balance, credit-pack picker → Stripe Checkout, transaction history from `ledger_entries`.
- Paywall states: preflight "costs N credits" affordance on run buttons; graceful insufficient-credits → top-up interruption. Balance stays non-ambient.
- Cost transparency: each run/training shows its settled debit.

## 10. Build order

| Phase | Scope | Rationale |
|---|---|---|
| **−1 Compute topology** | Decide: shared Comfy instance vs per-user pods vs serverless GPU. | Isolation model and who-can-run-what derive from it. Fixed per-action pricing removed the GPU-time-measurement dependency, but isolation still blocks the spike |
| **0 Spike** | Surface-B end-to-end on the chosen topology: authenticated proxy → price one prompt → forward → correlate ws success → mock debit. Includes §6 isolation | The only unknown-effort piece; estimate the rest after it lands |
| **1 Foundations** | Neon + schema, Clerk auth + session guard + user sync, app gated behind login. No money | Everything hangs off identity + DB |
| **2 Ledger + wallet** | `ledger.ts`, wallet UI, signup bonus. Debits against manually granted balances | Money core in isolation, testable before Stripe |
| **3 Stripe** | Checkout, webhook granting, refunds/disputes | Users can buy credits |
| **4 Metering A** | Provider proxies + training queue on hold/settle | The easy meter surface |
| **5 Metering B** | Graph runs metered via the Phase-0 mechanism; legacy-node pass-through policy enforced | De-risked by the spike |
| **6 Guardrails** | Moderation (both sides), velocity limits, reconciliation, spend alerts | Harden before public launch |

Effort: Phases 1–3 are well-trodden (~a week-ish each solo); Phase 5 is sized by the Phase-0 spike; Phase 6 is ongoing. No total estimate until the spike lands.

## 11. Out of scope (launch)

Subscriptions/auto-top-up, teams/orgs/seats, multi-currency, referral credits, admin dashboard beyond SQL. The hosted-GPU infrastructure build itself (provisioning, scaling, multi-tenant Comfy deployment) is a separate track — Phase −1 only *decides* its shape as far as metering needs it.

## 12. Open questions

1. **Compute topology (Phase −1)** — shared instance / per-user pods / serverless GPU.
2. **Output-side moderation mechanism** — which classifier, where in the pipeline, what happens on a flag.
3. **Credit-pack sizes and the credit↔dollar exchange rate** — product/pricing call, needed by Phase 3.
