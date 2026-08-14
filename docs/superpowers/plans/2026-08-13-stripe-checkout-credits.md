# Stripe Checkout → Credit Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plain-language summary (standing rule):** after this plan, a signed-in hosted user can click "Add credits", pick one of three packs ($10/$25/$60), pay on Stripe's own payment page, and see the credits land in their wallet a few seconds later — granted only by Stripe's signed server-to-server confirmation, never by the browser. Refunds automatically claw the credits back. Everything runs in Stripe **test mode** with test cards; no real money moves. Local mode is untouched: no Stripe code runs without keys.

**Goal:** `/api/billing/checkout` creates a Stripe Checkout Session for a decided pack; `/api/webhooks/stripe` (signature-verified) is the sole credit-granting path into the real ledger; the account page gets a buy-credits section built to the decided framing rules.

**Architecture:** A pure `packs.ts` module is the single source of truth for the decided ladder. The checkout route maps the Clerk user to a `stripe_customers` row (get-or-create) and creates a Session with `metadata: {userId, packId}`. The webhook route verifies signatures via the SDK, then a pure `handleStripeEvent()` (unit-testable, injected deps) grants `ledger.credit(userId, credits, 'pack_purchase', <eventId>)` — idempotent by the ledger's replay + 23505 machinery — and handles `charge.refunded` with a best-effort clawback debit. Stripe client is lazily constructed hosted-only, mirroring the Clerk client pattern in `auth.ts`.

**Tech Stack:** `stripe` SDK 22.x (already a dependency), existing ledger/`ledgerLive`, Nitro routes, vitest + PGlite. Env: `STRIPE_SECRET_KEY` (set in `.env.hosted`), `STRIPE_WEBHOOK_SECRET` (from `stripe listen`, set at verification time).

## Global Constraints

- **deployMode contract:** no Clerk keys ⇒ local mode ⇒ all new routes 404, no Stripe client ever constructed. Read env per-call, never at module level.
- **Decided pricing (2026-08-13, immutable here):** 1 credit = $0.01 fixed. Packs: `starter` $10/1,000cr · `creator` $25/2,750cr · `studio` $60/7,200cr. Framing: bonus shown as "+250 credits free"/"+1,200 credits free", NEVER percent-off; Creator is "Most popular"; captions denominate work, not arithmetic; no dark patterns.
- **The webhook is the SOLE credit-granting path** (spec §5.3). The success-redirect page must not grant anything.
- Idempotency key for grants = the Stripe **event id** (`evt_…`); ledger replay makes retried webhooks no-ops. Never construct keys with reserved prefixes `settle:`/`expire:`.
- New public path `/api/webhooks/stripe` goes in BOTH `PUBLIC_API_PATHS` (authGuard.ts) and stays covered by the existing `/api/webhooks` proxy allowlist (already present — verify, don't re-add). New `/api/billing` prefix MUST be added to `NITRO_API_PREFIXES` in comfyui-proxy.ts.
- **NEVER put a comma inside a trailing comment on an `export const` line in `server/`** — mlly's export scanner splits on commas and phantom auto-imports kill every Nitro boot (see memory `mlly-export-scanner-comma-comments`; this outage already happened once today).
- Action blue only; use `StudioButton` for action buttons; dark app styling per `app/pages/account.vue` patterns.
- Run vitest FROM `frontend/`. Stage ONLY your named files; never `git add -A` (parallel sessions). Commits end with the Claude Fable co-author line.
- A dev server owned by another session runs on 127.0.0.1:3000 in local mode — probe it, never restart/kill it.

---

### Task 1: Packs module + Stripe client factory

**Files:**
- Create: `frontend/server/utils/packs.ts`
- Create: `frontend/server/utils/stripeClient.ts`
- Test: `frontend/tests/unit/packs.unit.spec.ts`

**Interfaces:**
- Produces: `interface CreditPack { id: 'starter' | 'creator' | 'studio'; usd: number; credits: number; baseCredits: number; bonusCredits: number; label: string; caption: string }`
- `PACKS: CreditPack[]` (exactly 3, decided values), `packById(id: string): CreditPack | null`
- `getStripe(): Stripe` — lazy singleton, throws without `STRIPE_SECRET_KEY` (mirrors `getSharedLedgerDb` / auth.ts's `getClerkClient` pattern).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/packs.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { PACKS, packById } from '../../server/utils/packs'

describe('credit packs (pricing decision 2026-08-13)', () => {
  it('is exactly the decided ladder', () => {
    expect(PACKS.map(p => [p.id, p.usd, p.credits])).toEqual([
      ['starter', 10, 1000],
      ['creator', 25, 2750],
      ['studio', 60, 7200],
    ])
  })
  it('bonus arithmetic is self-consistent (1cr = $0.01 fixed, bonus on top)', () => {
    for (const p of PACKS) {
      expect(p.baseCredits).toBe(p.usd * 100)
      expect(p.bonusCredits).toBe(p.credits - p.baseCredits)
      expect(p.bonusCredits).toBeGreaterThanOrEqual(0)
    }
  })
  it('looks up by id and rejects unknown ids', () => {
    expect(packById('creator')?.credits).toBe(2750)
    expect(packById('mega')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/packs.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/packs`

- [ ] **Step 3: Implement**

```ts
// frontend/server/utils/packs.ts
/**
 * The decided credit ladder (pricing call 2026-08-13 — decision record in
 * docs/superpowers/specs/2026-08-13-pricing-proposal-draft.md). 1 credit =
 * $0.01, always; discounts exist ONLY as bonus credits so the rate is never
 * negotiable. Captions denominate work, not arithmetic (framing rules).
 */
export interface CreditPack {
  id: 'starter' | 'creator' | 'studio'
  usd: number
  credits: number
  baseCredits: number
  bonusCredits: number
  label: string
  caption: string
}

export const PACKS: CreditPack[] = [
  { id: 'starter', usd: 10, credits: 1000, baseCredits: 1000, bonusCredits: 0, label: 'Starter', caption: 'About a month of casual use' },
  { id: 'creator', usd: 25, credits: 2750, baseCredits: 2500, bonusCredits: 250, label: 'Creator', caption: 'A solid month for a regular user' },
  { id: 'studio', usd: 60, credits: 7200, baseCredits: 6000, bonusCredits: 1200, label: 'Studio', caption: 'A full heavy month in one top-up' },
]

export function packById(id: string): CreditPack | null {
  return PACKS.find(p => p.id === id) ?? null
}
```

```ts
// frontend/server/utils/stripeClient.ts
/**
 * Hosted-mode Stripe client. Lazy singleton — never constructed in local
 * mode (no STRIPE_SECRET_KEY there), mirroring the Clerk client in
 * server/middleware/auth.ts and getSharedLedgerDb's env discipline.
 */
import Stripe from 'stripe'

let stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('stripeClient: STRIPE_SECRET_KEY is not set (hosted mode requires it)')
    stripe = new Stripe(key)
  }
  return stripe
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/packs.unit.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/packs.ts server/utils/stripeClient.ts tests/unit/packs.unit.spec.ts
git commit -m "feat(billing): decided credit-pack ladder + lazy Stripe client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Checkout route

**Files:**
- Create: `frontend/server/api/billing/checkout.post.ts`
- Create: `frontend/server/utils/stripeCustomers.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` — add `'/api/billing'` to `NITRO_API_PREFIXES`
- Test: `frontend/tests/unit/stripe-customers.unit.spec.ts`

**Interfaces:**
- Consumes: `event.context.userId` (auth middleware), `getStripe()`, `packById`, `getSharedLedgerDb()` (for the `stripe_customers` table), `isHosted()`.
- Produces: `ensureStripeCustomer(db: LedgerDb, stripe: { customers: { create(p: any): Promise<{ id: string }> } }, userId: string, email?: string | null): Promise<string>` in stripeCustomers.ts — get-or-create against the `stripe_customers` table, returns the Stripe customer id. `POST /api/billing/checkout` body `{ packId: string }` → `{ url: string }` (the Stripe-hosted payment page).

- [ ] **Step 1: Write the failing test (PGlite, fake stripe)**

```ts
// frontend/tests/unit/stripe-customers.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ensureStripeCustomer } from '../../server/utils/stripeCustomers'

async function openTestDb() {
  const db = new PGlite()
  const schema = readFileSync(join(__dirname, '../../server/db/schema.sql'), 'utf8')
  await db.exec(schema)
  await db.query(`INSERT INTO users (id) VALUES ('user_1')`)
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params as any[]) }
}

describe('ensureStripeCustomer', () => {
  it('creates once, then reuses the stored mapping', async () => {
    const db = await openTestDb()
    const stripe = { customers: { create: vi.fn().mockResolvedValue({ id: 'cus_123' }) } }
    expect(await ensureStripeCustomer(db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(await ensureStripeCustomer(db, stripe, 'user_1', 'a@b.co')).toBe('cus_123')
    expect(stripe.customers.create).toHaveBeenCalledTimes(1)
    expect(stripe.customers.create).toHaveBeenCalledWith({ email: 'a@b.co', metadata: { userId: 'user_1' } })
  })
})
```

- [ ] **Step 2: Run to verify FAIL, then implement**

```ts
// frontend/server/utils/stripeCustomers.ts
/**
 * userId ↔ Stripe customer mapping (accounts spec §5.3 / stripe_customers
 * table). Get-or-create; the unique constraint makes concurrent creation
 * safe (second insert loses, we re-read).
 */
import type { LedgerDb } from './ledger'

interface StripeCustomersApi {
  customers: { create(params: { email?: string; metadata: { userId: string } }): Promise<{ id: string }> }
}

export async function ensureStripeCustomer(
  db: LedgerDb,
  stripe: StripeCustomersApi,
  userId: string,
  email?: string | null,
): Promise<string> {
  const existing = await db.query(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
  if (existing.rows.length) return existing.rows[0].stripe_customer_id
  const customer = await stripe.customers.create({ email: email ?? undefined, metadata: { userId } })
  try {
    await db.query(
      `INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES ($1, $2)`,
      [userId, customer.id])
  } catch (e: any) {
    if (e?.code === '23505') {
      const again = await db.query(
        `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1`, [userId])
      if (again.rows.length) return again.rows[0].stripe_customer_id
    }
    throw e
  }
  return customer.id
}
```

```ts
// frontend/server/api/billing/checkout.post.ts
/**
 * Creates a Stripe Checkout Session for a decided pack (spec §5.3). The
 * session carries {userId, packId} metadata; the WEBHOOK grants credits —
 * the success redirect grants nothing, ever.
 */
import { isHosted } from '~~/server/utils/deployMode'
import { getStripe } from '~~/server/utils/stripeClient'
import { packById } from '~~/server/utils/packs'
import { ensureStripeCustomer } from '~~/server/utils/stripeCustomers'
import { getSharedLedgerDb } from '~~/server/utils/ledgerDb'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })

  const body = await readBody(event)
  const pack = packById(String(body?.packId ?? ''))
  if (!pack) throw createError({ statusCode: 400, message: 'Unknown pack' })

  const stripe = getStripe()
  const customerId = await ensureStripeCustomer(getSharedLedgerDb(), stripe, userId)

  const origin = getRequestHeader(event, 'origin') ?? `http://${getRequestHeader(event, 'host') ?? '127.0.0.1:3000'}`
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: pack.usd * 100,
        product_data: {
          name: `Sailor — ${pack.label} pack`,
          description: `${pack.credits.toLocaleString('en-US')} credits${pack.bonusCredits ? ` (includes ${pack.bonusCredits.toLocaleString('en-US')} bonus credits)` : ''}`,
        },
      },
    }],
    metadata: { userId, packId: pack.id, credits: String(pack.credits) },
    success_url: `${origin}/account?purchase=success`,
    cancel_url: `${origin}/account?purchase=cancelled`,
  })

  if (!session.url) throw createError({ statusCode: 502, message: 'Stripe did not return a checkout URL' })
  return { url: session.url }
})
```

- [ ] **Step 3: Allowlist `/api/billing`**

Add `'/api/billing'` to the FRONT of `NITRO_API_PREFIXES` in `frontend/server/middleware/comfyui-proxy.ts` (single-line edit, same style as `/api/admin`).

- [ ] **Step 4: Tests + local-mode probe**

Run: `npx vitest run tests/unit/stripe-customers.unit.spec.ts` → PASS
Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X POST http://127.0.0.1:3000/api/billing/checkout` → `404` (local mode hides it; also proves allowlist — a proxied miss would return a ComfyUI-style error, not our 404)

- [ ] **Step 5: Commit**

```bash
git add server/api/billing/checkout.post.ts server/utils/stripeCustomers.ts server/middleware/comfyui-proxy.ts tests/unit/stripe-customers.unit.spec.ts
git commit -m "feat(billing): Stripe Checkout session route + customer mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Stripe webhook → ledger grant + refund clawback

**Files:**
- Create: `frontend/server/api/webhooks/stripe.post.ts`
- Create: `frontend/server/utils/stripeEvents.ts`
- Modify: `frontend/server/utils/authGuard.ts` — add `'/api/webhooks/stripe'` to `PUBLIC_API_PATHS`
- Test: `frontend/tests/unit/stripe-events.unit.spec.ts`

**Interfaces:**
- Consumes: `getStripe()` (`stripe.webhooks.constructEventAsync(rawBody, sig, secret)` — SDK v22 async form; secret from `process.env.STRIPE_WEBHOOK_SECRET`), `getLiveLedger()`, `packById`.
- Produces: `handleStripeEvent(evt: { id: string; type: string; data: { object: any } }, deps: StripeEventDeps): Promise<{ handled: boolean; action?: string }>` where `StripeEventDeps = { credit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean }>; debit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean; reason?: string }>; getAvailable(userId: string): Promise<number>; lookupUserByCustomer(customerId: string): Promise<string | null> }`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/stripe-events.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { handleStripeEvent } from '../../server/utils/stripeEvents'

function deps(overrides: Partial<Record<string, any>> = {}) {
  return {
    credit: vi.fn().mockResolvedValue({ ok: true, balance: 1000 }),
    debit: vi.fn().mockResolvedValue({ ok: true, balance: 0 }),
    getAvailable: vi.fn().mockResolvedValue(1000),
    lookupUserByCustomer: vi.fn().mockResolvedValue('user_1'),
    ...overrides,
  }
}

describe('handleStripeEvent', () => {
  it('checkout.session.completed grants the pack keyed by EVENT id', async () => {
    const d = deps()
    const res = await handleStripeEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { userId: 'user_1', packId: 'creator', credits: '2750' } } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'granted' })
    expect(d.credit).toHaveBeenCalledWith('user_1', 2750, 'pack_purchase:creator', 'evt_1')
  })

  it('unpaid session is acknowledged but grants nothing', async () => {
    const d = deps()
    const res = await handleStripeEvent({
      id: 'evt_2', type: 'checkout.session.completed',
      data: { object: { id: 'cs_2', payment_status: 'unpaid', metadata: { userId: 'user_1', packId: 'creator', credits: '2750' } } },
    }, d)
    expect(res.handled).toBe(false)
    expect(d.credit).not.toHaveBeenCalled()
  })

  it('metadata credits must match the pack table (tamper guard)', async () => {
    const d = deps()
    await expect(handleStripeEvent({
      id: 'evt_3', type: 'checkout.session.completed',
      data: { object: { id: 'cs_3', payment_status: 'paid', metadata: { userId: 'user_1', packId: 'creator', credits: '999999' } } },
    }, d)).rejects.toThrow(/pack mismatch/i)
    expect(d.credit).not.toHaveBeenCalled()
  })

  it('charge.refunded claws back up to the available balance and reports shortfall', async () => {
    const d = deps({ getAvailable: vi.fn().mockResolvedValue(100) })
    const res = await handleStripeEvent({
      id: 'evt_4', type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_9', amount_refunded: 2500 } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback_partial' })
    // $25 refunded = 2500 base credits owed back, but only 100 available
    expect(d.debit).toHaveBeenCalledWith('user_1', 100, 'refund_clawback', 'evt_4')
  })

  it('unknown event types are acknowledged, unhandled', async () => {
    const d = deps()
    expect((await handleStripeEvent({ id: 'evt_5', type: 'invoice.created', data: { object: {} } }, d)).handled).toBe(false)
  })
})
```

- [ ] **Step 2: RED run, then implement**

```ts
// frontend/server/utils/stripeEvents.ts
/**
 * Stripe webhook event handling (accounts spec §5.3), separated from the
 * route so it unit-tests without signatures. Grants are keyed by the Stripe
 * EVENT id — the ledger's idempotency replay makes redelivered webhooks
 * no-ops, and the 23505 catch covers concurrent duplicate delivery.
 *
 * Refund clawback is best-effort: debit up to the available balance and
 * report a shortfall (the user may have spent the credits — recovering the
 * remainder is a manual/abuse-policy concern, logged loudly, never silent).
 */
export interface StripeEventDeps {
  credit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean }>
  debit(userId: string, credits: number, reason: string, key: string): Promise<{ ok: boolean; reason?: string }>
  getAvailable(userId: string): Promise<number>
  lookupUserByCustomer(customerId: string): Promise<string | null>
}

import { packById } from './packs'

export async function handleStripeEvent(
  evt: { id: string; type: string; data: { object: any } },
  deps: StripeEventDeps,
): Promise<{ handled: boolean; action?: string }> {
  if (evt.type === 'checkout.session.completed') {
    const s = evt.data.object
    if (s?.payment_status !== 'paid') return { handled: false }
    const userId = s?.metadata?.userId
    const pack = packById(String(s?.metadata?.packId ?? ''))
    const credits = Number(s?.metadata?.credits)
    if (!userId || !pack) throw new Error('stripe webhook: completed session missing userId/packId metadata')
    if (credits !== pack.credits) throw new Error(`stripe webhook: pack mismatch — metadata says ${credits}, table says ${pack.credits}`)
    await deps.credit(userId, pack.credits, `pack_purchase:${pack.id}`, evt.id)
    return { handled: true, action: 'granted' }
  }

  if (evt.type === 'charge.refunded') {
    const c = evt.data.object
    const customerId = c?.customer
    if (!customerId) return { handled: false }
    const userId = await deps.lookupUserByCustomer(String(customerId))
    if (!userId) return { handled: false }
    const owed = Math.floor(Number(c?.amount_refunded ?? 0)) // cents = base credits (1cr = 1¢)
    if (owed <= 0) return { handled: false }
    const available = await deps.getAvailable(userId)
    const take = Math.min(owed, available)
    if (take > 0) await deps.debit(userId, take, 'refund_clawback', evt.id)
    if (take < owed) {
      console.error('[stripe] REFUND CLAWBACK SHORTFALL', { userId, owed, recovered: take, eventId: evt.id })
      return { handled: true, action: 'clawback_partial' }
    }
    return { handled: true, action: 'clawback' }
  }

  return { handled: false }
}
```

```ts
// frontend/server/api/webhooks/stripe.post.ts
/**
 * Stripe → Sailor credit granting (accounts spec §5.3). Signature-verified;
 * this is THE ONLY code path that turns money into credits. Public path
 * (signature is the auth), hosted-only.
 */
import { isHosted } from '~~/server/utils/deployMode'
import { getStripe } from '~~/server/utils/stripeClient'
import { getLiveLedger } from '~~/server/utils/ledgerLive'
import { getSharedLedgerDb } from '~~/server/utils/ledgerDb'
import { handleStripeEvent } from '~~/server/utils/stripeEvents'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw createError({ statusCode: 500, message: 'Webhook secret not configured' })

  const sig = getRequestHeader(event, 'stripe-signature')
  const raw = await readRawBody(event)
  if (!sig || !raw) throw createError({ statusCode: 400, message: 'Missing signature or body' })

  let evt: { id: string; type: string; data: { object: any } }
  try {
    evt = await getStripe().webhooks.constructEventAsync(raw, sig, secret) as any
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid webhook signature' })
  }

  const ledger = getLiveLedger()
  const db = getSharedLedgerDb()
  const result = await handleStripeEvent(evt, {
    credit: (u, c, reason, key) => ledger.credit(u, c, reason, key),
    debit: (u, c, reason, key) => ledger.debit(u, c, reason, key),
    getAvailable: u => ledger.getAvailable(u),
    lookupUserByCustomer: async (cusId) => {
      const { rows } = await db.query(
        `SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1`, [cusId])
      return rows.length ? rows[0].user_id : null
    },
  })
  return { ok: true, ...result }
})
```

- [ ] **Step 3: Public-path registration**

In `frontend/server/utils/authGuard.ts` change `PUBLIC_API_PATHS` to `['/api/webhooks/clerk', '/api/webhooks/stripe']`. Update the auth-guard test's export assertion (`tests/unit/auth-guard.unit.spec.ts` asserts `PUBLIC_API_PATHS).toContain('/api/webhooks/clerk')` — add a matching `toContain('/api/webhooks/stripe')`). Verify `/api/webhooks` is ALREADY in `NITRO_API_PREFIXES` (it is — do not duplicate).

- [ ] **Step 4: Tests + probes**

Run: `npx vitest run tests/unit/stripe-events.unit.spec.ts tests/unit/auth-guard.unit.spec.ts` → PASS (5 + 7)
Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X POST http://127.0.0.1:3000/api/webhooks/stripe` → `404` (local mode)

- [ ] **Step 5: Commit**

```bash
git add server/api/webhooks/stripe.post.ts server/utils/stripeEvents.ts server/utils/authGuard.ts tests/unit/stripe-events.unit.spec.ts tests/unit/auth-guard.unit.spec.ts
git commit -m "feat(billing): signature-verified Stripe webhook -> ledger grants + refund clawback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Buy-credits UI on the account page

**Files:**
- Modify: `frontend/app/pages/account.vue`
- Create: `frontend/server/api/billing/packs.get.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` — nothing (covered by `/api/billing`)
- Test: `frontend/tests/unit/packs-route-shape.unit.spec.ts`

**Interfaces:**
- Consumes: `PACKS`, `isHosted()`; Task 2's `POST /api/billing/checkout` → `{ url }`.
- Produces: `GET /api/billing/packs` → `{ packs: CreditPack[] }` hosted (public UI data, still behind auth guard); 404 local. Page: pack cards per framing rules, click → POST checkout → `window.location.href = url`; success/cancelled banners read `?purchase=` query.

- [ ] **Step 1: Failing test for the route payload helper**

```ts
// frontend/tests/unit/packs-route-shape.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { packsPayload } from '../../server/api/billing/packs.get'
import { PACKS } from '../../server/utils/packs'

describe('packsPayload', () => {
  it('returns the decided ladder verbatim', () => {
    expect(packsPayload()).toEqual({ packs: PACKS })
  })
})
```

- [ ] **Step 2: RED, then implement route**

```ts
// frontend/server/api/billing/packs.get.ts
import { isHosted } from '~~/server/utils/deployMode'
import { PACKS } from '~~/server/utils/packs'

export function packsPayload() {
  return { packs: PACKS }
}

export default defineEventHandler(() => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  return packsPayload()
})
```

- [ ] **Step 3: Extend account.vue**

Add below the Credits card (keep all existing content; framing rules are binding):

```vue
<!-- inside the v-if="hosted" container, after the credits card -->
      <div v-if="purchaseState === 'success'" class="mt-4 rounded-[8px] border border-emerald-400/40 bg-emerald-400/10 p-3 text-[12.5px] text-emerald-200/90">
        Payment received — your credits are on the way (a few seconds; this page refreshes automatically).
      </div>
      <div v-else-if="purchaseState === 'cancelled'" class="mt-4 rounded-[8px] border border-white/10 bg-white/[0.04] p-3 text-[12.5px] text-white/55">
        Checkout cancelled — nothing was charged.
      </div>

      <h2 class="mt-8 text-[11px] font-medium uppercase tracking-wide text-white/50">Add credits</h2>
      <div class="mt-3 grid grid-cols-1 gap-2.5">
        <button
          v-for="pack in packs" :key="pack.id"
          class="flex items-center gap-3 rounded-[8px] border p-4 text-left transition"
          :class="pack.id === 'creator' ? 'border-action/60 bg-action/5 hover:bg-action/10' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'"
          :disabled="buying !== null"
          @click="buy(pack.id)"
        >
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[14px] font-semibold">{{ pack.label }}</span>
              <span v-if="pack.id === 'creator'" class="rounded-full border border-action/50 px-2 py-px font-mono text-[9px] uppercase tracking-wider text-action">Most popular</span>
            </div>
            <div class="text-[12px] text-white/55">{{ pack.caption }}</div>
            <div class="mt-1 text-[12px] tabular-nums text-white/70">
              {{ pack.credits.toLocaleString('en-US') }} credits
              <span v-if="pack.bonusCredits" class="text-emerald-300/80">— includes {{ pack.bonusCredits.toLocaleString('en-US') }} free</span>
            </div>
          </div>
          <span class="text-[18px] font-semibold tabular-nums">${{ pack.usd }}</span>
        </button>
      </div>
      <p class="mt-3 text-[11px] leading-relaxed text-white/35">
        1 credit = 1¢, always. Bonus credits expire after 30 days; purchased credits after 12 months.
        Payments are processed by Stripe — Sailor never sees your card.
      </p>
```

Script additions (merge into the existing setup):

```ts
import { PACKS } from '~~/server/utils/packs'   // NO — server import in a page will not resolve; instead:
const { data: packsData } = await useFetch<{ packs: { id: string; usd: number; credits: number; baseCredits: number; bonusCredits: number; label: string; caption: string }[] }>('/api/billing/packs', { server: false })
const packs = computed(() => packsData.value?.packs ?? [])

const route = useRoute()
const purchaseState = computed(() => route.query.purchase === 'success' ? 'success' : route.query.purchase === 'cancelled' ? 'cancelled' : null)

const buying = ref<string | null>(null)
async function buy(packId: string) {
  buying.value = packId
  try {
    const res = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { packId } })
    window.location.href = res.url
  } catch (e) {
    console.error('checkout failed', e)
    buying.value = null
  }
}

// After a success redirect, poll the wallet a few times so the webhook's
// grant appears without a manual reload (webhook may lag the redirect).
if (import.meta.client) {
  watch(purchaseState, (s) => {
    if (s !== 'success') return
    let tries = 0
    const t = setInterval(async () => {
      tries += 1
      await refreshWallet()
      if (tries >= 10) clearInterval(t)
    }, 2000)
  }, { immediate: true })
}
```

(The existing wallet `useFetch` must expose its `refresh` as `refreshWallet` — rename via `const { data: wallet, refresh: refreshWallet } = await useFetch(...)`. The commented "NO" line is a reminder, not code — do not import server modules into pages.)

- [ ] **Step 4: Tests + local probes**

Run: `npx vitest run tests/unit/packs-route-shape.unit.spec.ts` → PASS
Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/billing/packs` → `404` (local)
Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/account` → `200` (local redirect shell, no 500)

- [ ] **Step 5: Commit**

```bash
git add app/pages/account.vue server/api/billing/packs.get.ts tests/unit/packs-route-shape.unit.spec.ts
git commit -m "feat(billing): buy-credits section on the account page (decided framing rules)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Live test-mode verification run-book (controller-executed)

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-stripe-testmode-verification.md`

This task is executed BY THE CONTROLLER (not a subagent): it needs the hosted worktree server, `stripe listen`, and a browser click-through of Stripe's hosted page with the public test card `4242 4242 4242 4242` (test mode — no real payment instrument; documented publicly by Stripe).

- [ ] **Step 1:** Recreate the hosted worktree server (same recipe as the Stage 1 smoke run-book — worktree + symlinked node_modules + `./node_modules/.bin/nuxt dev --port 3100`, env from `.env.hosted`) at current HEAD. CAUTION from today's outage: do NOT run `pnpm add/install` in the main checkout while both servers run.
- [ ] **Step 2:** `stripe listen --forward-to 127.0.0.1:3100/api/webhooks/stripe` (background); it prints `whsec_…` — export it as `STRIPE_WEBHOOK_SECRET` in the hosted server's env (restart the worktree server with it). Append the secret to `.env.hosted` for future runs.
- [ ] **Step 3:** Browser: sign in on :3100 (Julien's existing account), open /account, click the Creator pack, complete Stripe Checkout with card `4242 4242 4242 4242`, any future expiry, any CVC.
- [ ] **Step 4:** Verify: `stripe listen` log shows `checkout.session.completed` → 200; Neon `ledger_entries` gains a `pack_purchase:creator` credit of 2750 keyed `evt_…`; /account wallet shows the new balance. Replay the same event (`stripe events resend <evt_id>`) → ledger unchanged (idempotency proven live).
- [ ] **Step 5:** Refund the test payment (`stripe refunds create --charge <ch_…>`) → verify `refund_clawback` debit appears and wallet drops.
- [ ] **Step 6:** Record every observed value in the run-book doc; tear down per the Stage 1 recipe; commit the doc.

---

## Self-review notes

- Spec §5.3 coverage: checkout (T2), webhook sole-grant + signature (T3), refund clawback (T3), Radar/velocity limits deliberately deferred to the guardrails stage (roadmap Stage 7) — noted, not smuggled in.
- Framing rules from the decision record: bonus-as-credits (T4 copy), Most-popular on Creator (T4), work captions (T1 pack captions), expiries stated (T4 footer), no dark patterns. Bonus **expiry enforcement** (30-day) is NOT built here — the ledger supports `expiresAt` on credits; wiring it to pack bonuses is a small follow-up flagged in the run-book.
- The clawback partial-recovery policy (T3) refines spec §5.3's bare "negative ledger entry": the ledger's debit refuses overdrafts, so v1 recovers what exists and logs the shortfall loudly. Flagged as a policy note in the run-book.
- Task-2 test's fake `stripe.customers.create` asserts the exact param shape the real call uses; the checkout session call itself is exercised live in T5 (no mock-only path claims to prove it).
