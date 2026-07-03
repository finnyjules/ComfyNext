# Surface-B Metering Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove ComfyUI graph runs can be priced, preflighted against a wallet, forwarded to the engine, correlated to their success event, and debited exactly once — end-to-end against the real local ComfyUI — so the rest of the accounts/billing build can be sized.

**Architecture:** A single authenticated Nitro choke-point route (`POST /api/meter/prompt`) stands in front of ComfyUI. It prices the submitted graph from a versioned price book, checks the caller's available balance, strips any comfy.org credential it didn't receive from that caller, forwards the graph to ComfyUI's real `POST /prompt`, captures the returned `prompt_id`, and registers a pending charge. A settlement watcher polls `GET /history/{prompt_id}` until the run completes and debits a mock ledger only on `status_str === 'success'`. Everything money-related is an in-memory mock whose function signatures mirror the real `ledger.ts` from spec §5.2, so Phase 2 swaps the implementation without touching callers.

**Tech Stack:** Nuxt 4 / Nitro (h3) server routes + auto-imported `server/utils/*`; TypeScript; Vitest (`tests/unit/**/*.unit.spec.ts`, node env); the running ComfyUI engine at `http://127.0.0.1:8188`.

## Why these decisions (findings that shaped the plan)

- **`execution_success` is NOT broadcast.** It is sent to the submitting client's `client_id` only (`execution.py:793` calls `add_message(..., broadcast=False)`, which at `execution.py:680` targets `self.server.client_id`). A server-side websocket listener with its own `clientId` would never see it. → **The spike correlates success via `GET /history/{prompt_id}` polling**, whose entry carries `status: {status_str: 'success'|'error', completed: bool}` (`execution.py:1216`). This needs no websocket proxy.
- **The canvas submits prompts inside the iframe** via `window.app.queuePrompt(0)` straight to `:8188` (`custom_nodes/comfynext_bridge/js/bridge.js:1126`), bypassing Nitro. That is exactly the spec §6 isolation hole. → **The spike does NOT try to re-route the iframe.** It proves the mechanism through a new authenticated route driven directly (curl/tests/live smoke). Re-hosting the iframe + websocket behind the authed proxy and binding `:8188` private is the remaining production-isolation task; the spike's job is to make that the *only* unknown left, and to record an effort estimate for it (Task 7).
- **No Postgres/Clerk/Stripe deps are added.** The ledger, auth, and pending-charge store are in-memory mocks with production-shaped interfaces.

## Global Constraints

Every task's requirements implicitly include these (copied from `docs/superpowers/specs/2026-07-01-accounts-credits-billing-design.md` and the costs companion):

- **1 credit = $0.01.** All prices are integer credits.
- **Only the ledger module writes balances.** No other module mutates `balance_credits`. (Spec §4, §5.2.)
- **Every debit carries an idempotency key** = the `prompt_id`. A retried settlement or double-submit must never double-charge. (Spec §4 invariants.)
- **Preflight checks *available* balance** (`balance − reserved`), not raw balance. The spike has no holds, so `reserved = 0` and `available === balance`, but the call site MUST use `getAvailable()` so Phase 2 holds work unchanged. (Spec §4.)
- **Debit on success only.** A `status_str === 'error'` run, a crash, or a timeout is never charged. (Spec §3 Surface B, §5.4.)
- **Price from a versioned price book;** every ledger debit records the price-book version that priced it. (Spec §4 `price_book`, §5.2.)
- **No operator comfy.org credential; strip foreign ones.** The route forwards only a comfy.org credential supplied by that same caller; it strips any it did not receive from the caller. (Spec §7 hard rule.)
- **Mock interfaces mirror the real `ledger.ts` (§5.2):** `getBalance(userId)`, `getAvailable(userId)`, `credit(userId, amount, reason, idempotencyKey)`, `debit(userId, amount, reason, idempotencyKey)`. These names/signatures are the swap contract — do not rename them.
- **Tests:** `frontend/tests/unit/<name>.unit.spec.ts`, imported as `import { x } from '~~/server/utils/<name>'`, run with `cd frontend && npx vitest run tests/unit/<name>.unit.spec.ts`.

---

## File Structure

- `frontend/server/utils/priceBook.ts` — versioned price book + `priceGraph()`. Pure.
- `frontend/server/utils/mockLedger.ts` — in-memory wallet + append-only entries, production-shaped. The Phase-2 swap target.
- `frontend/server/utils/meterStore.ts` — in-memory pending-charge registry keyed by `prompt_id`. Pure-ish (module singleton).
- `frontend/server/utils/spikeAuth.ts` — stub session → `userId` + comfy.org credential stripping. Stands in for Clerk (§5.1).
- `frontend/server/utils/settleWatcher.ts` — poll `/history/{prompt_id}` → success/error callback. Pure (deps injected).
- `frontend/server/utils/meterPrompt.ts` — pure orchestrator: price → preflight → forward → register → settle. All I/O injected.
- `frontend/server/api/meter/prompt.post.ts` — thin route wiring real deps to `meterPrompt()`.
- `docs/superpowers/spikes/2026-07-03-surface-b-findings.md` — the spike's written output: what was proven, the mock→real swap points, and the iframe/ws isolation effort estimate.

---

## Task 1: Price book + `priceGraph`

**Files:**
- Create: `frontend/server/utils/priceBook.ts`
- Test: `frontend/tests/unit/price-book.unit.spec.ts`

**Interfaces:**
- Produces: `interface GraphPrice { credits: number; version: string; breakdown: { action: string; credits: number }[] }` and `priceGraph(prompt: Record<string, { class_type: string; inputs?: unknown }>): GraphPrice`, plus `PRICE_BOOK_VERSION: string`.
- Consumed by: Task 6 (`meterPrompt`).

The `prompt` is ComfyUI's API-format graph: an object keyed by node id, each value `{ class_type, inputs }`. Pricing model for the spike: a flat **base render** cost applies once if the graph has any terminal output node (image/video/audio save or preview); **premium actions** (paid provider nodes) add their per-node cost on top. Values come from the costs doc (`1 credit = $0.01`).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/price-book.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { priceGraph, PRICE_BOOK_VERSION } from '~~/server/utils/priceBook'

const render = { '1': { class_type: 'KSampler' }, '2': { class_type: 'SaveImage' } }

describe('priceGraph', () => {
  it('charges the base render once for a plain image graph', () => {
    const p = priceGraph(render)
    expect(p.credits).toBe(1)
    expect(p.version).toBe(PRICE_BOOK_VERSION)
    expect(p.breakdown).toEqual([{ action: 'base_render', credits: 1 }])
  })

  it('adds premium per-action costs on top of the base render', () => {
    const p = priceGraph({ ...render, '3': { class_type: 'EditImageNode' } })
    expect(p.credits).toBe(13) // 1 base + 12 NB2 edit
    expect(p.breakdown).toContainEqual({ action: 'EditImageNode', credits: 12 })
  })

  it('does not charge a base render when the graph has no output node', () => {
    expect(priceGraph({ '1': { class_type: 'CheckpointLoaderSimple' } }).credits).toBe(0)
  })

  it('is deterministic regardless of node-key order', () => {
    const a = priceGraph({ '9': { class_type: 'SaveImage' }, '1': { class_type: 'KSampler' } })
    const b = priceGraph({ '1': { class_type: 'KSampler' }, '9': { class_type: 'SaveImage' } })
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/price-book.unit.spec.ts`
Expected: FAIL — `Cannot find module '~~/server/utils/priceBook'`.

- [ ] **Step 3: Implement the minimal code**

```typescript
// frontend/server/utils/priceBook.ts
/**
 * Versioned price book + graph pricer (spike). Prices a ComfyUI API-format
 * graph in integer credits (1 credit = $0.01). A flat base_render applies once
 * for any graph with a terminal output node; premium provider nodes add their
 * per-node cost on top. Phase 3 moves this table to the Postgres `price_book`.
 */
export const PRICE_BOOK_VERSION = 'spike-v1'

const BASE_RENDER_CREDITS = 1

// Terminal output nodes that mean "the GPU produced a deliverable" → base render.
const OUTPUT_CLASS_TYPES = new Set([
  'SaveImage', 'PreviewImage', 'SaveVideo', 'VHS_VideoCombine', 'SaveAudio',
])

// Premium provider actions, from the costs doc. Flat per-node for the spike.
const PREMIUM_ACTION_CREDITS: Record<string, number> = {
  EditImageNode: 12,       // Nano-Banana-2 edit
  GenerateVideoNode: 60,   // mid video / 5s
  FilmShotNode: 160,       // Seedance 720p / 5s
  LipSyncNode: 30,
  LoraTrainingNode: 600,
}

export interface GraphPrice {
  credits: number
  version: string
  breakdown: { action: string; credits: number }[]
}

export function priceGraph(prompt: Record<string, { class_type: string; inputs?: unknown }>): GraphPrice {
  const breakdown: { action: string; credits: number }[] = []
  let hasOutput = false

  // Sort node ids for order-independent, deterministic breakdown.
  for (const id of Object.keys(prompt).sort()) {
    const ct = prompt[id]?.class_type
    if (!ct) continue
    if (OUTPUT_CLASS_TYPES.has(ct)) hasOutput = true
    const premium = PREMIUM_ACTION_CREDITS[ct]
    if (premium) breakdown.push({ action: ct, credits: premium })
  }

  const out: { action: string; credits: number }[] = []
  if (hasOutput) out.push({ action: 'base_render', credits: BASE_RENDER_CREDITS })
  out.push(...breakdown)

  return {
    credits: out.reduce((s, b) => s + b.credits, 0),
    version: PRICE_BOOK_VERSION,
    breakdown: out,
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/price-book.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/priceBook.ts frontend/tests/unit/price-book.unit.spec.ts
git commit -m "feat(meter-spike): versioned price book + priceGraph"
```

---

## Task 2: Mock ledger (production-shaped)

**Files:**
- Create: `frontend/server/utils/mockLedger.ts`
- Test: `frontend/tests/unit/mock-ledger.unit.spec.ts`

**Interfaces:**
- Produces: a `mockLedger` object with `getBalance(userId): number`, `getAvailable(userId): number`, `credit(userId, amount, reason, idempotencyKey): LedgerResult`, `debit(userId, amount, reason, idempotencyKey): LedgerResult`, plus test helpers `__reset()` and `__seed(userId, credits)`. `LedgerResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient' }`.
- Consumed by: Task 6.

Rules from Global Constraints: idempotency key dedupes (same key → no second effect, returns the prior balance); `debit` rejects when `amount > getAvailable`; `reserved` is always 0 in the spike so `getAvailable === getBalance`. This is the Phase-2 swap target — keep the four public names exactly.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/mock-ledger.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mockLedger } from '~~/server/utils/mockLedger'

beforeEach(() => mockLedger.__reset())

describe('mockLedger', () => {
  it('credits and reports balance and available', () => {
    mockLedger.credit('u1', 150, 'signup_bonus', 'seed-u1')
    expect(mockLedger.getBalance('u1')).toBe(150)
    expect(mockLedger.getAvailable('u1')).toBe(150)
  })

  it('debits down to zero and rejects an overdraw', () => {
    mockLedger.__seed('u1', 10)
    expect(mockLedger.debit('u1', 4, 'generation', 'p-1')).toEqual({ ok: true, balance: 6 })
    expect(mockLedger.debit('u1', 99, 'generation', 'p-2')).toEqual({ ok: false, reason: 'insufficient' })
    expect(mockLedger.getBalance('u1')).toBe(6)
  })

  it('is idempotent on repeated debit with the same key', () => {
    mockLedger.__seed('u1', 10)
    const a = mockLedger.debit('u1', 3, 'generation', 'prompt-abc')
    const b = mockLedger.debit('u1', 3, 'generation', 'prompt-abc')
    expect(a).toEqual({ ok: true, balance: 7 })
    expect(b).toEqual({ ok: true, balance: 7 }) // no second charge
    expect(mockLedger.getBalance('u1')).toBe(7)
  })

  it('treats an unknown user as zero balance', () => {
    expect(mockLedger.getAvailable('nobody')).toBe(0)
    expect(mockLedger.debit('nobody', 1, 'generation', 'x')).toEqual({ ok: false, reason: 'insufficient' })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/mock-ledger.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the minimal code**

```typescript
// frontend/server/utils/mockLedger.ts
/**
 * In-memory mock of the real ledger (spec §5.2). Same public surface —
 * getBalance / getAvailable / credit / debit — so Phase 2 replaces the guts
 * with Postgres + SELECT…FOR UPDATE without changing any caller. Idempotency
 * keys dedupe retries/double-submits. No holds in the spike → available == balance.
 */
export type LedgerResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient' }

interface Wallet { balance: number }

const wallets = new Map<string, Wallet>()
const seenKeys = new Map<string, number>() // idempotencyKey → balance-after (for replay)

function wallet(userId: string): Wallet {
  let w = wallets.get(userId)
  if (!w) { w = { balance: 0 }; wallets.set(userId, w) }
  return w
}

export const mockLedger = {
  getBalance(userId: string): number {
    return wallets.get(userId)?.balance ?? 0
  },
  // reserved is always 0 in the spike; the name is the Phase-2 contract.
  getAvailable(userId: string): number {
    return this.getBalance(userId)
  },
  credit(userId: string, amount: number, _reason: string, idempotencyKey: string): LedgerResult {
    if (seenKeys.has(idempotencyKey)) return { ok: true, balance: seenKeys.get(idempotencyKey)! }
    const w = wallet(userId)
    w.balance += amount
    seenKeys.set(idempotencyKey, w.balance)
    return { ok: true, balance: w.balance }
  },
  debit(userId: string, amount: number, _reason: string, idempotencyKey: string): LedgerResult {
    if (seenKeys.has(idempotencyKey)) return { ok: true, balance: seenKeys.get(idempotencyKey)! }
    const w = wallet(userId)
    if (amount > w.balance) return { ok: false, reason: 'insufficient' }
    w.balance -= amount
    seenKeys.set(idempotencyKey, w.balance)
    return { ok: true, balance: w.balance }
  },
  __reset(): void { wallets.clear(); seenKeys.clear() },
  __seed(userId: string, credits: number): void { wallet(userId).balance = credits },
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/mock-ledger.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/mockLedger.ts frontend/tests/unit/mock-ledger.unit.spec.ts
git commit -m "feat(meter-spike): in-memory mock ledger with idempotent debit"
```

---

## Task 3: Pending-charge registry

**Files:**
- Create: `frontend/server/utils/meterStore.ts`
- Test: `frontend/tests/unit/meter-store.unit.spec.ts`

**Interfaces:**
- Produces: `interface PendingCharge { userId: string; credits: number; version: string; status: 'pending' | 'settled' | 'voided' }` and a `meterStore` with `register(promptId, charge): void`, `get(promptId): PendingCharge | undefined`, `resolve(promptId, status): void`, `__reset(): void`. `register`'s `charge` arg is `Omit<PendingCharge, 'status'>`.
- Consumed by: Task 6.

Purpose: hold the priced-but-not-yet-settled charge between the forward and the settlement, keyed by `prompt_id`, so the watcher (and any later reconciliation) can find it.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/meter-store.unit.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { meterStore } from '~~/server/utils/meterStore'

beforeEach(() => meterStore.__reset())

describe('meterStore', () => {
  it('registers a pending charge and reads it back', () => {
    meterStore.register('p1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    expect(meterStore.get('p1')).toEqual({ userId: 'u1', credits: 4, version: 'spike-v1', status: 'pending' })
  })

  it('resolves a charge to settled or voided', () => {
    meterStore.register('p1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    meterStore.resolve('p1', 'settled')
    expect(meterStore.get('p1')?.status).toBe('settled')
  })

  it('returns undefined for an unknown prompt id', () => {
    expect(meterStore.get('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/meter-store.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the minimal code**

```typescript
// frontend/server/utils/meterStore.ts
/**
 * In-memory registry of priced-but-unsettled graph runs, keyed by prompt_id.
 * Bridges the forward (Task 6) and the settlement (Task 5). Phase 5 replaces
 * this with the Postgres `holds`/pending rows so it survives a server restart.
 */
export interface PendingCharge {
  userId: string
  credits: number
  version: string
  status: 'pending' | 'settled' | 'voided'
}

const pending = new Map<string, PendingCharge>()

export const meterStore = {
  register(promptId: string, charge: Omit<PendingCharge, 'status'>): void {
    pending.set(promptId, { ...charge, status: 'pending' })
  },
  get(promptId: string): PendingCharge | undefined {
    return pending.get(promptId)
  },
  resolve(promptId: string, status: 'settled' | 'voided'): void {
    const c = pending.get(promptId)
    if (c) c.status = status
  },
  __reset(): void { pending.clear() },
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/meter-store.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/meterStore.ts frontend/tests/unit/meter-store.unit.spec.ts
git commit -m "feat(meter-spike): pending-charge registry keyed by prompt_id"
```

---

## Task 4: Stub auth + comfy.org credential stripping

**Files:**
- Create: `frontend/server/utils/spikeAuth.ts`
- Test: `frontend/tests/unit/spike-auth.unit.spec.ts`

**Interfaces:**
- Produces:
  - `resolveSpikeUser(headers: Record<string, string | undefined>): string | null` — returns the user id from the `x-spike-user` header, or null. (Stands in for the Clerk session JWT of §5.1; a pure function so it is unit-testable without an h3 event.)
  - `stripForeignComfyOrgCreds(extraData: Record<string, any> | undefined, callerSuppliedKey: string | null): Record<string, any>` — returns a copy of `extraData` with `auth_token_comfy_org` / `api_key_comfy_org` removed unless they equal `callerSuppliedKey` (§7 hard rule: only pass through a credential this caller supplied; never an operator one).
- Consumed by: Task 6 (route) and Task 7 (auth test).

Spec §7 names the sensitive keys `auth_token_comfy_org` and `api_key_comfy_org` inside prompt `extra_data`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/spike-auth.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { resolveSpikeUser, stripForeignComfyOrgCreds } from '~~/server/utils/spikeAuth'

describe('resolveSpikeUser', () => {
  it('reads the user id from x-spike-user', () => {
    expect(resolveSpikeUser({ 'x-spike-user': 'u1' })).toBe('u1')
  })
  it('returns null when the header is absent or blank', () => {
    expect(resolveSpikeUser({})).toBeNull()
    expect(resolveSpikeUser({ 'x-spike-user': '  ' })).toBeNull()
  })
})

describe('stripForeignComfyOrgCreds', () => {
  it('removes an operator/foreign comfy.org credential the caller did not supply', () => {
    const out = stripForeignComfyOrgCreds({ auth_token_comfy_org: 'OPERATOR', client_id: 'c1' }, null)
    expect(out).toEqual({ client_id: 'c1' })
  })
  it('passes through the caller-supplied key unchanged', () => {
    const out = stripForeignComfyOrgCreds({ api_key_comfy_org: 'MINE', client_id: 'c1' }, 'MINE')
    expect(out).toEqual({ api_key_comfy_org: 'MINE', client_id: 'c1' })
  })
  it('handles missing extra_data', () => {
    expect(stripForeignComfyOrgCreds(undefined, null)).toEqual({})
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/spike-auth.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the minimal code**

```typescript
// frontend/server/utils/spikeAuth.ts
/**
 * Spike stand-in for the Clerk session guard (spec §5.1) and the §7 comfy.org
 * credential rule. resolveSpikeUser reads a caller id from a header instead of
 * verifying a JWT — Phase 1 replaces it with the real Clerk middleware, keeping
 * the "route gets a userId or 401" contract. stripForeignComfyOrgCreds enforces
 * the hard rule: never forward a comfy.org credential this caller didn't supply.
 */
const COMFY_ORG_KEYS = ['auth_token_comfy_org', 'api_key_comfy_org'] as const

export function resolveSpikeUser(headers: Record<string, string | undefined>): string | null {
  const raw = headers['x-spike-user']
  const id = (raw ?? '').trim()
  return id || null
}

export function stripForeignComfyOrgCreds(
  extraData: Record<string, any> | undefined,
  callerSuppliedKey: string | null,
): Record<string, any> {
  const out: Record<string, any> = { ...(extraData ?? {}) }
  for (const k of COMFY_ORG_KEYS) {
    if (k in out && out[k] !== callerSuppliedKey) delete out[k]
  }
  return out
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/spike-auth.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/spikeAuth.ts frontend/tests/unit/spike-auth.unit.spec.ts
git commit -m "feat(meter-spike): stub session auth + comfy.org credential stripping"
```

---

## Task 5: Settlement watcher (history poll)

**Files:**
- Create: `frontend/server/utils/settleWatcher.ts`
- Test: `frontend/tests/unit/settle-watcher.unit.spec.ts`

**Interfaces:**
- Produces: `settleOnCompletion(opts): Promise<'success' | 'error' | 'timeout'>` where
  ```typescript
  interface SettleOpts {
    promptId: string
    pollHistory: (promptId: string) => Promise<HistoryEntry | null>
    onSuccess: (promptId: string) => void
    onError: (promptId: string) => void
    sleep?: (ms: number) => Promise<void>   // injectable for tests; default real setTimeout
    intervalMs?: number                     // default 1000
    maxPolls?: number                       // default 120 (~2 min)
  }
  interface HistoryEntry { status?: { status_str?: 'success' | 'error'; completed?: boolean } }
  ```
- Consumed by: Task 6.

Behavior: poll `pollHistory(promptId)` up to `maxPolls` times, sleeping `intervalMs` between polls. When an entry arrives with `status.completed === true`, call `onSuccess` (if `status_str === 'success'`) or `onError` (otherwise) and return. If `maxPolls` is exhausted with no completion, call `onError` (never charge an unconfirmed run) and return `'timeout'`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/settle-watcher.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { settleOnCompletion } from '~~/server/utils/settleWatcher'

const noSleep = () => Promise.resolve()

describe('settleOnCompletion', () => {
  it('settles on a success status after a couple of empty polls', async () => {
    const seq = [null, null, { status: { status_str: 'success' as const, completed: true } }]
    let i = 0
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => seq[i++] ?? null,
      onSuccess, onError, sleep: noSleep, intervalMs: 0,
    })
    expect(r).toBe('success')
    expect(onSuccess).toHaveBeenCalledWith('p1')
    expect(onError).not.toHaveBeenCalled()
  })

  it('voids on an error status', async () => {
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => ({ status: { status_str: 'error', completed: true } }),
      onSuccess, onError, sleep: noSleep, intervalMs: 0,
    })
    expect(r).toBe('error')
    expect(onError).toHaveBeenCalledWith('p1')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('times out without charging when the run never completes', async () => {
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => null,
      onSuccess, onError, sleep: noSleep, intervalMs: 0, maxPolls: 3,
    })
    expect(r).toBe('timeout')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('p1')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/settle-watcher.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the minimal code**

```typescript
// frontend/server/utils/settleWatcher.ts
/**
 * Correlate a graph run to its outcome by polling GET /history/{prompt_id}.
 * We poll (not websocket) because ComfyUI sends execution_success only to the
 * submitting client_id, not broadcast (execution.py:793 → add_message
 * broadcast=False → execution.py:680). All I/O is injected so this is a pure,
 * fast unit. Debit-on-success only: an error OR a timeout calls onError.
 */
export interface HistoryEntry { status?: { status_str?: 'success' | 'error'; completed?: boolean } }

export interface SettleOpts {
  promptId: string
  pollHistory: (promptId: string) => Promise<HistoryEntry | null>
  onSuccess: (promptId: string) => void
  onError: (promptId: string) => void
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  maxPolls?: number
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function settleOnCompletion(opts: SettleOpts): Promise<'success' | 'error' | 'timeout'> {
  const { promptId, pollHistory, onSuccess, onError } = opts
  const sleep = opts.sleep ?? realSleep
  const intervalMs = opts.intervalMs ?? 1000
  const maxPolls = opts.maxPolls ?? 120

  for (let n = 0; n < maxPolls; n++) {
    const entry = await pollHistory(promptId)
    if (entry?.status?.completed) {
      if (entry.status.status_str === 'success') { onSuccess(promptId); return 'success' }
      onError(promptId); return 'error'
    }
    await sleep(intervalMs)
  }
  onError(promptId) // never charge a run we could not confirm
  return 'timeout'
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/settle-watcher.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/settleWatcher.ts frontend/tests/unit/settle-watcher.unit.spec.ts
git commit -m "feat(meter-spike): history-poll settlement watcher (debit on success only)"
```

---

## Task 6: Meter orchestrator + route

**Files:**
- Create: `frontend/server/utils/meterPrompt.ts` (pure orchestrator — all I/O injected)
- Create: `frontend/server/api/meter/prompt.post.ts` (thin route wiring real deps)
- Modify: `frontend/server/middleware/comfyui-proxy.ts:27` (add `/api/meter` to `NITRO_API_PREFIXES` so the route is not proxied to ComfyUI)
- Test: `frontend/tests/unit/meter-prompt.unit.spec.ts`

**Interfaces:**
- Consumes: `priceGraph` (T1), `mockLedger` (T2), `meterStore` (T3), `settleOnCompletion` (T5).
- Produces:
  ```typescript
  interface MeterDeps {
    priceGraph: (prompt: any) => { credits: number; version: string; breakdown: any[] }
    getAvailable: (userId: string) => number
    register: (promptId: string, charge: { userId: string; credits: number; version: string }) => void
    forward: (body: any) => Promise<{ prompt_id: string }>       // POST to ComfyUI /prompt
    settle: (promptId: string, userId: string, credits: number, version: string) => void  // fire-and-forget
  }
  interface MeterResult { promptId: string; credits: number; version: string }
  class MeterError extends Error { code: 'unauthorized' | 'insufficient' | 'bad_request'; available?: number; required?: number }
  async function meterPrompt(userId: string | null, body: any, deps: MeterDeps): Promise<MeterResult>
  ```
- The route maps `MeterError.code` → HTTP status: `unauthorized` → 401, `insufficient` → 402, `bad_request` → 400.

Order of operations in `meterPrompt` (this order is the whole point — preflight must happen **before** forward):
1. If `userId` is null → throw `MeterError('unauthorized')`.
2. If `body.prompt` is not an object → throw `MeterError('bad_request')`.
3. `price = priceGraph(body.prompt)`.
4. If `price.credits > getAvailable(userId)` → throw `MeterError('insufficient')` **before forwarding** (nothing runs).
5. `{ prompt_id } = await forward(body)`.
6. `register(prompt_id, { userId, credits: price.credits, version: price.version })`.
7. `settle(prompt_id, userId, price.credits, price.version)` (fire-and-forget; the watcher debits on success).
8. Return `{ promptId: prompt_id, credits: price.credits, version: price.version }`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/meter-prompt.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { meterPrompt, MeterError } from '~~/server/utils/meterPrompt'

function deps(over: Partial<any> = {}) {
  return {
    priceGraph: () => ({ credits: 4, version: 'spike-v1', breakdown: [] }),
    getAvailable: () => 100,
    register: vi.fn(),
    forward: vi.fn(async () => ({ prompt_id: 'PID-1' })),
    settle: vi.fn(),
    ...over,
  }
}
const body = { prompt: { '1': { class_type: 'KSampler' }, '2': { class_type: 'SaveImage' } } }

describe('meterPrompt', () => {
  it('prices, preflights, forwards, registers, settles', async () => {
    const d = deps()
    const r = await meterPrompt('u1', body, d)
    expect(r).toEqual({ promptId: 'PID-1', credits: 4, version: 'spike-v1' })
    expect(d.forward).toHaveBeenCalledOnce()
    expect(d.register).toHaveBeenCalledWith('PID-1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    expect(d.settle).toHaveBeenCalledWith('PID-1', 'u1', 4, 'spike-v1')
  })

  it('rejects an unauthenticated caller before doing anything', async () => {
    const d = deps()
    await expect(meterPrompt(null, body, d)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('refuses insufficient balance WITHOUT forwarding', async () => {
    const d = deps({ getAvailable: () => 1 }) // price 4 > 1
    await expect(meterPrompt('u1', body, d)).rejects.toMatchObject({ code: 'insufficient', available: 1, required: 4 })
    expect(d.forward).not.toHaveBeenCalled()
    expect(d.register).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    await expect(meterPrompt('u1', {}, deps())).rejects.toBeInstanceOf(MeterError)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/meter-prompt.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

```typescript
// frontend/server/utils/meterPrompt.ts
/**
 * Pure Surface-B orchestrator: price → preflight → forward → register → settle.
 * All I/O is injected (MeterDeps) so it unit-tests with fakes and the route
 * stays a thin adapter. The invariant that matters: the available-balance
 * check happens BEFORE forward(), so an underfunded run never reaches the GPU.
 */
export type MeterErrorCode = 'unauthorized' | 'insufficient' | 'bad_request'

export class MeterError extends Error {
  code: MeterErrorCode
  available?: number
  required?: number
  constructor(code: MeterErrorCode, message?: string, extra?: { available?: number; required?: number }) {
    super(message ?? code)
    this.code = code
    this.available = extra?.available
    this.required = extra?.required
  }
}

export interface MeterDeps {
  priceGraph: (prompt: any) => { credits: number; version: string; breakdown: any[] }
  getAvailable: (userId: string) => number
  register: (promptId: string, charge: { userId: string; credits: number; version: string }) => void
  forward: (body: any) => Promise<{ prompt_id: string }>
  settle: (promptId: string, userId: string, credits: number, version: string) => void
}

export interface MeterResult { promptId: string; credits: number; version: string }

export async function meterPrompt(userId: string | null, body: any, deps: MeterDeps): Promise<MeterResult> {
  if (!userId) throw new MeterError('unauthorized', 'Sign in to run graphs')
  if (!body || typeof body.prompt !== 'object' || body.prompt === null) {
    throw new MeterError('bad_request', 'Missing prompt graph')
  }

  const price = deps.priceGraph(body.prompt)
  const available = deps.getAvailable(userId)
  if (price.credits > available) {
    throw new MeterError('insufficient', 'Not enough credits', { available, required: price.credits })
  }

  const { prompt_id } = await deps.forward(body)
  deps.register(prompt_id, { userId, credits: price.credits, version: price.version })
  deps.settle(prompt_id, userId, price.credits, price.version)
  return { promptId: prompt_id, credits: price.credits, version: price.version }
}
```

- [ ] **Step 4: Run the orchestrator tests and make sure they pass**

Run: `cd frontend && npx vitest run tests/unit/meter-prompt.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the route and its allow-list entry**

Edit `frontend/server/middleware/comfyui-proxy.ts` line 27 — add `/api/meter` to `NITRO_API_PREFIXES` so the middleware lets Nitro handle it instead of proxying to ComfyUI:

```typescript
const NITRO_API_PREFIXES = ['/api/templates', '/api/cloud-train', '/api/voice-clone', '/api/training-queue', '/api/krea', '/api/vector', '/api/inpaint', '/api/brand-kits', '/api/template-fonts', '/api/characters-local', '/api/lipsync', '/api/meter']
```

Create the thin route:

```typescript
// frontend/server/api/meter/prompt.post.ts
/**
 * POST /api/meter/prompt — the authenticated Surface-B choke point (spike).
 * Wires the real deps into meterPrompt(): stub auth, price book, mock ledger,
 * pending-charge store, forward-to-ComfyUI, and the history-poll watcher that
 * debits on success. In production this route (or its middleware form) is the
 * ONLY way a graph reaches the engine; see the isolation note in the findings doc.
 */
import { meterPrompt, MeterError } from '~~/server/utils/meterPrompt'
import { priceGraph } from '~~/server/utils/priceBook'
import { mockLedger } from '~~/server/utils/mockLedger'
import { meterStore } from '~~/server/utils/meterStore'
import { settleOnCompletion } from '~~/server/utils/settleWatcher'
import { resolveSpikeUser, stripForeignComfyOrgCreds } from '~~/server/utils/spikeAuth'

const COMFY = 'http://127.0.0.1:8188'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const userId = resolveSpikeUser(getHeaders(event) as Record<string, string | undefined>)

  const deps = {
    priceGraph,
    getAvailable: (u: string) => mockLedger.getAvailable(u),
    register: (promptId: string, charge: { userId: string; credits: number; version: string }) =>
      meterStore.register(promptId, charge),
    forward: async (b: any) => {
      // §7: forward only a comfy.org credential this caller supplied.
      const callerKey = (b?.extra_data?.api_key_comfy_org ?? b?.extra_data?.auth_token_comfy_org) ?? null
      const safeBody = { ...b, extra_data: stripForeignComfyOrgCreds(b?.extra_data, callerKey) }
      const res = await fetch(`${COMFY}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: COMFY },
        body: JSON.stringify(safeBody),
      })
      if (!res.ok) throw new MeterError('bad_request', `ComfyUI rejected the prompt (${res.status})`)
      return await res.json() as { prompt_id: string }
    },
    settle: (promptId: string, u: string, credits: number, version: string) => {
      void settleOnCompletion({
        promptId,
        pollHistory: async (id) => {
          const r = await fetch(`${COMFY}/history/${id}`)
          if (!r.ok) return null
          const hist = await r.json() as Record<string, any>
          return hist[id] ?? null
        },
        onSuccess: (id) => {
          const r = mockLedger.debit(u, credits, `graph_run:${version}`, id)
          meterStore.resolve(id, r.ok ? 'settled' : 'voided')
        },
        onError: (id) => meterStore.resolve(id, 'voided'),
      })
    },
  }

  try {
    return await meterPrompt(userId, body, deps)
  }
  catch (err) {
    if (err instanceof MeterError) {
      const status = err.code === 'unauthorized' ? 401 : err.code === 'insufficient' ? 402 : 400
      throw createError({ statusCode: status, message: err.message, data: { code: err.code, available: err.available, required: err.required } })
    }
    throw err
  }
})
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "meterPrompt|meter/prompt|priceBook|mockLedger|meterStore|settleWatcher|spikeAuth" || echo "meter files clean"`
Expected: `meter files clean` (baseline unrelated errors elsewhere are fine).

- [ ] **Step 7: Commit**

```bash
git add frontend/server/utils/meterPrompt.ts frontend/server/api/meter/prompt.post.ts frontend/server/middleware/comfyui-proxy.ts frontend/tests/unit/meter-prompt.unit.spec.ts
git commit -m "feat(meter-spike): authenticated /api/meter/prompt choke-point route"
```

---

## Task 7: Auth/isolation guard test + findings doc

**Files:**
- Create: `docs/superpowers/spikes/2026-07-03-surface-b-findings.md`
- Test: extend `frontend/tests/unit/meter-prompt.unit.spec.ts` with an isolation assertion (kept at the orchestrator level — a null user is refused before any I/O).

**Interfaces:** none new. This task records the spike's conclusions and locks the security-critical "no auth → nothing runs" behavior with a test.

- [ ] **Step 1: Add the isolation regression test**

Append to `frontend/tests/unit/meter-prompt.unit.spec.ts`:

```typescript
describe('meterPrompt isolation', () => {
  it('does not price, forward, register, or settle for an anonymous caller', async () => {
    const priceGraph = vi.fn(() => ({ credits: 4, version: 'spike-v1', breakdown: [] }))
    const forward = vi.fn(); const register = vi.fn(); const settle = vi.fn()
    await expect(meterPrompt(null, body, {
      priceGraph, getAvailable: () => 100, register, forward: forward as any, settle,
    })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(priceGraph).not.toHaveBeenCalled()
    expect(forward).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to make sure it passes**

Run: `cd frontend && npx vitest run tests/unit/meter-prompt.unit.spec.ts`
Expected: PASS (5 tests total). If the anonymous-caller check runs `priceGraph` before the null guard, move the null-user throw to the very top of `meterPrompt` (it already is) — the test enforces that ordering.

- [ ] **Step 3: Write the findings doc**

```markdown
# Surface-B Metering Spike — Findings (2026-07-03)

## What the spike proves
An authenticated Nitro route (`POST /api/meter/prompt`) can:
- price an arbitrary ComfyUI API-format graph in integer credits from a versioned price book;
- check the caller's *available* balance and refuse an underfunded run **before** anything reaches the GPU (HTTP 402, nothing forwarded);
- forward a funded graph to the real engine and capture its `prompt_id`;
- correlate that `prompt_id` to its outcome and debit the ledger **exactly once, on success only** (idempotency key = `prompt_id`);
- strip any comfy.org credential the caller did not supply (§7 hard rule).

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

## The remaining unknown: iframe + ws isolation (the real infra effort)
The spike deliberately does NOT re-route the canvas. To ship Surface B, all engine traffic must go through the authed proxy and `:8188` must be private (§6):
1. **Re-host the ComfyUI iframe behind Nitro** so its HTTP (`/prompt`, `/view`, `/upload`, `/object_info`) is served through the authenticated proxy rather than direct-to-`:8188`.
2. **Proxy the ComfyUI websocket** (`/ws`) through Nitro (h3/crossws) — needed both for isolation and, if we later prefer ws-frame settlement over history-polling.
3. **Bind `:8188` to a private interface** on the RunPod topology; only Nitro can reach it.
4. Redirect the bridge's `queuePrompt` through the metered route (or make the proxied `/prompt` itself the meter).

**Estimate:** _[fill in after the live smoke — the point of the spike is to size this. Record: does proxying the ws in Nitro dev work cleanly? does the iframe tolerate a same-origin proxy path? rough day count for Phase 5.]_

## Effort estimate for the rest (fill after smoke)
_[Phases 1–3 are ~a week each per the spec; confirm nothing here contradicts that. Note any surprises.]_
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/spikes/2026-07-03-surface-b-findings.md frontend/tests/unit/meter-prompt.unit.spec.ts
git commit -m "docs(meter-spike): Surface-B findings + anonymous-caller isolation test"
```

---

## Task 8: Live end-to-end smoke against real ComfyUI

**Files:**
- Modify: `docs/superpowers/spikes/2026-07-03-surface-b-findings.md` (fill the estimate sections with observed results)

**Prerequisite:** ComfyUI running at `127.0.0.1:8188` and this session's Nuxt dev server running (via `preview_start` on the `frontend-harness` config — autoport, won't collide). Use `127.0.0.1:<port>` (not `localhost` — IPv6 → 426).

This task has no unit test; it is the manual end-to-end validation that the mechanism works against the real engine, and it produces the effort numbers the spike exists for.

- [ ] **Step 1: Seed a mock wallet via a throwaway dev-only route**

The mock ledger is per-process in-memory, so seed it in the same server process. Add a tiny dev seed endpoint (delete before merge), `frontend/server/api/meter/__seed.post.ts`:

```typescript
// DEV-ONLY: seed the in-memory mock wallet for the live smoke. Remove before merge.
import { mockLedger } from '~~/server/utils/mockLedger'
export default defineEventHandler(async (event) => {
  const { userId, credits } = await readBody(event) as { userId: string; credits: number }
  mockLedger.__seed(userId, credits)
  return { balance: mockLedger.getBalance(userId) }
})
```

Add `/api/meter` is already allow-listed (Task 6). Seed:
```bash
curl -s -X POST http://127.0.0.1:<port>/api/meter/__seed \
  -H 'Content-Type: application/json' -d '{"userId":"u1","credits":100}'
# → {"balance":100}
```

- [ ] **Step 2: Funded success path — expect a debit**

Submit a real minimal graph (grab one from a working canvas run, or the smallest checkpoint→KSampler→VAEDecode→SaveImage graph valid on this install) as `{ "prompt": { ... }, "client_id": "smoke" }`:

```bash
curl -s -X POST http://127.0.0.1:<port>/api/meter/prompt \
  -H 'Content-Type: application/json' -H 'x-spike-user: u1' \
  -d @/tmp/smoke-graph.json    # { "prompt": {…}, "client_id": "smoke" }
# Expect: {"promptId":"<uuid>","credits":1,"version":"spike-v1"}
```
Wait for the run to finish, then confirm the debit landed:
```bash
curl -s -X POST http://127.0.0.1:<port>/api/meter/__seed \
  -H 'Content-Type: application/json' -d '{"userId":"u1","credits":100}'  # re-read? no — instead:
```
Add a dev balance read to `__seed.post.ts` return or a `GET` variant; confirm `getBalance('u1') === 99` (100 − 1 base render). Record the observed latency from submit → debit.

- [ ] **Step 3: Insufficient-funds path — expect 402, no run**

```bash
curl -s -X POST http://127.0.0.1:<port>/api/meter/__seed -H 'Content-Type: application/json' -d '{"userId":"u2","credits":0}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:<port>/api/meter/prompt \
  -H 'Content-Type: application/json' -H 'x-spike-user: u2' -d @/tmp/smoke-graph.json
# Expect: 402  (and ComfyUI queue stays empty — nothing forwarded)
```

- [ ] **Step 4: Failure path — expect no debit**

Submit a graph that will error (e.g. reference a missing checkpoint filename) as `u1`; confirm it returns a `promptId` (it was accepted + forwarded) but the balance is **unchanged** after it fails (`status_str: 'error'` → `onError` → voided, no debit).

- [ ] **Step 5: Anonymous path — expect 401**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:<port>/api/meter/prompt \
  -H 'Content-Type: application/json' -d @/tmp/smoke-graph.json
# Expect: 401  (no x-spike-user header)
```

- [ ] **Step 6: Record results + fill the findings estimate, remove the seed route**

Fill the "remaining unknown" and "effort estimate" sections of the findings doc with observed numbers (submit→debit latency, whether history-poll kept up, any ComfyUI quirks). Delete `frontend/server/api/meter/__seed.post.ts`.

- [ ] **Step 7: Full gate + commit**

```bash
cd frontend && npx vitest run tests/unit/price-book.unit.spec.ts tests/unit/mock-ledger.unit.spec.ts tests/unit/meter-store.unit.spec.ts tests/unit/spike-auth.unit.spec.ts tests/unit/settle-watcher.unit.spec.ts tests/unit/meter-prompt.unit.spec.ts
# Expect: all pass (19 tests across the 6 files)
git add docs/superpowers/spikes/2026-07-03-surface-b-findings.md
git rm frontend/server/api/meter/__seed.post.ts
git commit -m "docs(meter-spike): live end-to-end results + effort estimate; drop dev seed route"
```

---

## Self-Review

**1. Spec coverage (§ vs task):**
- §3 Surface B (price → check wallet → forward → debit on success by prompt_id, no charge on failure) → Tasks 1, 5, 6, 8. ✓
- §4 invariants (idempotency key = prompt_id; available not raw; price-book version on the debit) → Tasks 2 (idempotency), 6 (getAvailable preflight), 1+6 (version threaded into the debit reason). ✓
- §5.2 ledger surface (getBalance/getAvailable/credit/debit) → Task 2, names locked. ✓
- §5.4 Surface B metering → Tasks 5, 6. ✓
- §6 isolation (auth on every forwarded run; :8188 private; all traffic through proxy) → Task 6 (auth choke point + 401), Task 7 (isolation test + the private-:8188/ws-proxy effort written up as the remaining infra task). The *code* proves the auth gate; the *infra* half is explicitly out of the spike and documented — matches the spec calling Phase 0 the effort-sizing spike, not the isolation build. ✓
- §7 comfy.org pass-through/strip → Task 4 + Task 6 forward(). ✓
- Deliberately deferred (correct for a spike, per spec §10/§11): real Clerk, real Postgres ledger, Stripe, holds/settle (Surface A only), moderation, velocity limits. Documented as swap points in Task 7. ✓

**2. Placeholder scan:** The only intentional "fill in" is Task 7's estimate sections — that is the spike's *output*, filled by Task 8 from live results, not a plan gap. All code steps contain complete code. ✓

**3. Type consistency:** `getAvailable` (T2) is the name called in T6 preflight and injected in the route. `priceGraph`→`{credits,version,breakdown}` (T1) matches `MeterDeps.priceGraph` (T6). `settleOnCompletion` opts (T5) match the route's `settle` wiring (T6). `MeterError.code` ∈ {unauthorized, insufficient, bad_request} maps to 401/402/400 in both the interface and the route. `meterStore.register(promptId, {userId,credits,version})` (T3) matches the `register` dep call (T6). ✓

**Scope note:** The live smoke (Task 8) needs a real valid ComfyUI graph for this install and a running engine — the executor should capture one working graph JSON from a normal canvas run first. The dev seed route is deliberately created and then removed within Task 8 so the mock wallet can be seeded in-process.
