# Hosted-Mode Switch + Ledger Core + Observational Metering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vendor-free core of consumer-product Stages 1–2: the local/hosted mode switch, the real Postgres ledger (tested against in-process PGlite), and observational spend logging on the two provider chokepoints.

**Architecture:** A `deployMode()` env probe gates everything hosted (no Clerk keys ⇒ local mode ⇒ exactly today's behavior). The ledger is a pure module `createLedger(db)` over a minimal `{ query }` DB handle — PGlite in tests, Neon later, no connection management inside. Spend logging is fire-and-forget JSONL appended from `runReplicate`/`runFal`, so a month of local usage produces the consumption data the pricing decisions need.

**Tech Stack:** TypeScript (Nitro server utils), PGlite (`@electric-sql/pglite`, devDependency, in-memory Postgres for tests), Vitest (`tests/unit/**/*.unit.spec.ts` pattern, run via `npx vitest run <file>`).

**Plain-language summary:** Nothing in this plan needs a signup or spends money. We build the light switch that tells Sailor "you're a hosted product now" (off by default), the real bank-ledger code fully tested against a throwaway in-process database, and a quiet logbook that records every time Sailor calls a paid AI service — so when we set prices later, we set them from real usage numbers.

## Global Constraints

- Working directory for all commands: `/Users/julien/Documents/GitHub/Sailor/frontend` unless stated otherwise.
- This repo uses **pnpm**, never npm. A dev server from another session may be running; `pnpm add` can make its routes 500 (known stale-path issue). If that happens the fix is `./dev.sh` from the repo root — do NOT debug the 500s.
- Design spec: `docs/superpowers/specs/2026-07-01-accounts-credits-billing-design.md` (§4 data model, §5.2 ledger API). The mock being replaced: `frontend/server/utils/mockLedger.ts` — keep its `LedgerResult` shape.
- 1 credit = $0.01. All credit amounts are **integers**.
- No top-level module constants that read other modules' state at import time (known init-order flake source). Lazy-init inside functions.
- Commit after every task, staging ONLY the task's files (parallel sessions share this tree). Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests as `npx vitest run tests/unit/<file>` (targeted — full-suite counts are unreliable under load on this machine).

---

### Task 1: The deploy-mode switch

**Files:**
- Create: `frontend/server/utils/deployMode.ts`
- Test: `frontend/tests/unit/deploy-mode.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deployMode(): 'local' | 'hosted'` and `isHosted(): boolean` — every later hosted-only feature gates on these. Hosted iff `process.env.NUXT_CLERK_SECRET_KEY` is a non-empty string.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/deploy-mode.unit.spec.ts
import { afterEach, describe, expect, it } from 'vitest'
import { deployMode, isHosted } from '../../server/utils/deployMode'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const saved = process.env[KEY]

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

describe('deployMode', () => {
  it('is local when no Clerk key is set — the non-negotiable default', () => {
    delete process.env[KEY]
    expect(deployMode()).toBe('local')
    expect(isHosted()).toBe(false)
  })

  it('is local when the key is empty or whitespace', () => {
    process.env[KEY] = '   '
    expect(deployMode()).toBe('local')
  })

  it('is hosted when a Clerk secret key is present', () => {
    process.env[KEY] = 'sk_test_abc123'
    expect(deployMode()).toBe('hosted')
    expect(isHosted()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deploy-mode.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/deployMode`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/server/utils/deployMode.ts
/**
 * The deployment switch (accounts spec §10 Phase 1): no Clerk keys in env ⇒
 * local mode — no login, no metering, exactly the pre-accounts behavior.
 * Hosted mode activates ONLY when a Clerk secret key is configured.
 *
 * Read from process.env (not runtimeConfig) so it works in unit tests and
 * outside request context. Evaluated per call — never cache at module level.
 */
export type DeployMode = 'local' | 'hosted'

export function deployMode(): DeployMode {
  const key = process.env.NUXT_CLERK_SECRET_KEY
  return typeof key === 'string' && key.trim().length > 0 ? 'hosted' : 'local'
}

export function isHosted(): boolean {
  return deployMode() === 'hosted'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/deploy-mode.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/deployMode.ts frontend/tests/unit/deploy-mode.unit.spec.ts
git commit -m "feat(hosted): deployMode switch — no Clerk keys means local mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Postgres schema + PGlite harness + user/wallet bootstrap

**Files:**
- Create: `frontend/server/db/schema.sql`
- Create: `frontend/server/utils/ledger.ts` (first slice)
- Test: `frontend/tests/unit/ledger-core.unit.spec.ts`
- Modify: `frontend/package.json` (via `pnpm add -D @electric-sql/pglite`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (later tasks extend this exact object):

```ts
export interface LedgerDb { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
export type LedgerResult = { ok: true, balance: number } | { ok: false, reason: 'insufficient' }
export function createLedger(db: LedgerDb): {
  ensureUser(userId: string): Promise<void>
  getBalance(userId: string): Promise<number>
  getAvailable(userId: string): Promise<number>
}
```

- Also produces the test harness helper `openTestDb()` in the spec file that Tasks 3–5 copy.

- [ ] **Step 1: Install PGlite (devDependency)**

Run: `pnpm add -D @electric-sql/pglite`
Expected: lockfile updated, no errors. (If another session's dev server starts 500ing afterwards, that's the known stale-path issue — `./dev.sh` from repo root fixes it; do not debug.)

- [ ] **Step 2: Write the schema**

```sql
-- frontend/server/db/schema.sql
-- Accounts spec §4. Idempotent (IF NOT EXISTS) so tests and boot can re-run it.
-- 1 credit = $0.01, integer credits only.

CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,          -- Clerk user id
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id          text PRIMARY KEY REFERENCES users(id),
  balance_credits  integer NOT NULL DEFAULT 0,
  reserved_credits integer NOT NULL DEFAULT 0,  -- sum of open holds
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Append-only double-entry log. Every balance change is a row here; wallets
-- carries a cached copy. `remaining_credits`/`expires_at` are credit-row-only:
-- debits consume credit rows FIFO by expiry so subscription grants (Phase 2+)
-- burn before purchased packs.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id),
  kind               text NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount             integer NOT NULL CHECK (amount > 0),
  reason             text NOT NULL,
  idempotency_key    text NOT NULL,
  balance_after      integer NOT NULL,
  remaining_credits  integer,
  expires_at         timestamptz,
  price_book_version text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ledger_entries_fifo
  ON ledger_entries (user_id, expires_at, id)
  WHERE kind = 'credit' AND remaining_credits > 0;

CREATE TABLE IF NOT EXISTS holds (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  amount          integer NOT NULL CHECK (amount > 0),
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled', 'released')),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS price_book (
  version text NOT NULL,
  action  text NOT NULL,
  credits integer NOT NULL,
  PRIMARY KEY (version, action)
);

CREATE TABLE IF NOT EXISTS stripe_customers (
  user_id            text PRIMARY KEY REFERENCES users(id),
  stripe_customer_id text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    text,
  provider   text NOT NULL,
  model      text,
  usd        numeric,
  job_id     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Write the failing test (harness + bootstrap)**

```ts
// frontend/tests/unit/ledger-core.unit.spec.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

// Fresh in-memory Postgres per test — no server, no cleanup.
export async function openTestDb() {
  const db = new PGlite()
  await db.exec(schema)
  return db
}

describe('ledger: user + wallet bootstrap', () => {
  it('ensureUser creates user and zero wallet, idempotently', async () => {
    const ledger = createLedger(await openTestDb())
    await ledger.ensureUser('user_a')
    await ledger.ensureUser('user_a') // second call must not throw
    expect(await ledger.getBalance('user_a')).toBe(0)
    expect(await ledger.getAvailable('user_a')).toBe(0)
  })

  it('getBalance of an unknown user is 0, not an error', async () => {
    const ledger = createLedger(await openTestDb())
    expect(await ledger.getBalance('nobody')).toBe(0)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger-core.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/ledger`.

- [ ] **Step 5: Write minimal implementation**

```ts
// frontend/server/utils/ledger.ts
/**
 * The money core (accounts spec §5.2). Append-only double-entry ledger with a
 * cached wallet balance. NOTHING else writes ledger_entries or wallet columns.
 *
 * Pure module over a minimal DB handle: PGlite in unit tests, a Neon/pg client
 * in production. The handle must be a SINGLE session (not a pool) — methods
 * issue BEGIN/COMMIT on it. Replaces mockLedger.ts (same LedgerResult shape,
 * but async).
 */
export interface LedgerDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>
}

export type LedgerResult =
  | { ok: true, balance: number }
  | { ok: false, reason: 'insufficient' }

export function createLedger(db: LedgerDb) {
  async function ensureUser(userId: string): Promise<void> {
    await db.query(
      `INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId])
    await db.query(
      `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId])
  }

  async function getBalance(userId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT balance_credits FROM wallets WHERE user_id = $1`, [userId])
    return rows[0]?.balance_credits ?? 0
  }

  async function getAvailable(userId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT balance_credits - reserved_credits AS available FROM wallets WHERE user_id = $1`,
      [userId])
    return rows[0]?.available ?? 0
  }

  return { ensureUser, getBalance, getAvailable }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/ledger-core.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/db/schema.sql frontend/server/utils/ledger.ts \
  frontend/tests/unit/ledger-core.unit.spec.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "feat(ledger): accounts schema + PGlite test harness + user/wallet bootstrap

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: credit / debit with idempotency

**Files:**
- Modify: `frontend/server/utils/ledger.ts` (extend the object returned by `createLedger`)
- Test: `frontend/tests/unit/ledger-money.unit.spec.ts`

**Interfaces:**
- Consumes: `createLedger`, `LedgerDb`, `LedgerResult`, `ensureUser` from Task 2; copies `openTestDb()` from Task 2's spec (duplicate the ~10-line helper into this spec file — do not import across spec files).
- Produces:

```ts
credit(userId: string, amount: number, reason: string, idempotencyKey: string,
       opts?: { expiresAt?: string | null, priceBookVersion?: string | null }): Promise<LedgerResult>
debit(userId: string, amount: number, reason: string, idempotencyKey: string,
      opts?: { priceBookVersion?: string | null }): Promise<LedgerResult>
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/ledger-money.unit.spec.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function openTestDb() {
  const db = new PGlite()
  await db.exec(schema)
  return db
}

async function ledgerWithUser(userId = 'u1') {
  const ledger = createLedger(await openTestDb())
  await ledger.ensureUser(userId)
  return ledger
}

describe('ledger: credit + debit', () => {
  it('credit then debit moves the balance', async () => {
    const l = await ledgerWithUser()
    const c = await l.credit('u1', 500, 'signup_bonus', 'bonus:u1')
    expect(c).toEqual({ ok: true, balance: 500 })
    const d = await l.debit('u1', 120, 'generation', 'prompt:abc')
    expect(d).toEqual({ ok: true, balance: 380 })
    expect(await l.getBalance('u1')).toBe(380)
  })

  it('debit beyond available is rejected and changes nothing', async () => {
    const l = await ledgerWithUser()
    await l.credit('u1', 100, 'topup', 'k1')
    const d = await l.debit('u1', 101, 'generation', 'k2')
    expect(d).toEqual({ ok: false, reason: 'insufficient' })
    expect(await l.getBalance('u1')).toBe(100)
  })

  it('replayed idempotency key returns the original result without double-applying', async () => {
    const l = await ledgerWithUser()
    await l.credit('u1', 100, 'topup', 'stripe_evt_1')
    const replay = await l.credit('u1', 100, 'topup', 'stripe_evt_1')
    expect(replay).toEqual({ ok: true, balance: 100 }) // balance-after of the ORIGINAL
    expect(await l.getBalance('u1')).toBe(100)         // not 200

    await l.debit('u1', 40, 'generation', 'prompt:x')
    const replayDebit = await l.debit('u1', 40, 'generation', 'prompt:x')
    expect(replayDebit).toEqual({ ok: true, balance: 60 })
    expect(await l.getBalance('u1')).toBe(60)
  })

  it('every movement lands in ledger_entries with balance_after', async () => {
    const db = await openTestDb()
    const l = createLedger(db)
    await l.ensureUser('u1')
    await l.credit('u1', 100, 'topup', 'k1')
    await l.debit('u1', 30, 'generation', 'k2')
    const { rows } = await db.query(
      `SELECT kind, amount, balance_after FROM ledger_entries WHERE user_id = 'u1' ORDER BY id`)
    expect(rows).toEqual([
      { kind: 'credit', amount: 100, balance_after: 100 },
      { kind: 'debit', amount: 30, balance_after: 70 },
    ])
  })

  it('rejects non-positive and non-integer amounts', async () => {
    const l = await ledgerWithUser()
    await expect(l.credit('u1', 0, 'x', 'k')).rejects.toThrow()
    await expect(l.credit('u1', -5, 'x', 'k')).rejects.toThrow()
    await expect(l.credit('u1', 1.5, 'x', 'k')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger-money.unit.spec.ts`
Expected: FAIL — `l.credit is not a function`.

- [ ] **Step 3: Implement credit/debit inside `createLedger`**

Add inside `createLedger(db)` (before the return) and extend the returned object with `credit, debit`:

```ts
  function assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error(`ledger amount must be a positive integer, got ${amount}`)
  }

  /** Replay lookup: if this (user, kind, key) was already applied, return its balance-after. */
  async function replayOf(userId: string, kind: 'credit' | 'debit', key: string): Promise<number | null> {
    const { rows } = await db.query(
      `SELECT balance_after FROM ledger_entries
       WHERE user_id = $1 AND kind = $2 AND idempotency_key = $3`,
      [userId, kind, key])
    return rows.length ? rows[0].balance_after : null
  }

  async function credit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { expiresAt?: string | null, priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    await db.query('BEGIN')
    try {
      const replayed = await replayOf(userId, 'credit', idempotencyKey)
      if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
      const { rows } = await db.query(
        `UPDATE wallets SET balance_credits = balance_credits + $2, updated_at = now()
         WHERE user_id = $1 RETURNING balance_credits`, [userId, amount])
      if (!rows.length) throw new Error(`ledger.credit: no wallet for ${userId} — call ensureUser first`)
      const balance = rows[0].balance_credits
      await db.query(
        `INSERT INTO ledger_entries
           (user_id, kind, amount, reason, idempotency_key, balance_after,
            remaining_credits, expires_at, price_book_version)
         VALUES ($1, 'credit', $2, $3, $4, $5, $2, $6, $7)`,
        [userId, amount, reason, idempotencyKey, balance,
         opts.expiresAt ?? null, opts.priceBookVersion ?? null])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  /** Consume credit rows FIFO by expiry (soonest first, NULL = never expires = last). */
  async function consumeFifo(userId: string, amount: number): Promise<void> {
    let left = amount
    const { rows } = await db.query(
      `SELECT id, remaining_credits FROM ledger_entries
       WHERE user_id = $1 AND kind = 'credit' AND remaining_credits > 0
       ORDER BY expires_at ASC NULLS LAST, id ASC
       FOR UPDATE`, [userId])
    for (const row of rows) {
      if (left <= 0) break
      const take = Math.min(left, row.remaining_credits)
      await db.query(
        `UPDATE ledger_entries SET remaining_credits = remaining_credits - $2 WHERE id = $1`,
        [row.id, take])
      left -= take
    }
    // left > 0 can only happen if remaining tracking drifted from balance
    // (e.g. a settle overrun) — balance stays authoritative, so ignore.
  }

  async function debit(
    userId: string, amount: number, reason: string, idempotencyKey: string,
    opts: { priceBookVersion?: string | null } = {},
  ): Promise<LedgerResult> {
    assertAmount(amount)
    await db.query('BEGIN')
    try {
      const replayed = await replayOf(userId, 'debit', idempotencyKey)
      if (replayed !== null) { await db.query('COMMIT'); return { ok: true, balance: replayed } }
      const { rows } = await db.query(
        `SELECT balance_credits, reserved_credits FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId])
      if (!rows.length) throw new Error(`ledger.debit: no wallet for ${userId} — call ensureUser first`)
      const available = rows[0].balance_credits - rows[0].reserved_credits
      if (amount > available) { await db.query('ROLLBACK'); return { ok: false, reason: 'insufficient' } }
      const balance = rows[0].balance_credits - amount
      await db.query(
        `UPDATE wallets SET balance_credits = $2, updated_at = now() WHERE user_id = $1`,
        [userId, balance])
      await consumeFifo(userId, amount)
      await db.query(
        `INSERT INTO ledger_entries
           (user_id, kind, amount, reason, idempotency_key, balance_after, price_book_version)
         VALUES ($1, 'debit', $2, $3, $4, $5, $6)`,
        [userId, amount, reason, idempotencyKey, balance, opts.priceBookVersion ?? null])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }
```

Return object becomes: `{ ensureUser, getBalance, getAvailable, credit, debit }`.

- [ ] **Step 4: Run tests to verify they pass (both spec files)**

Run: `npx vitest run tests/unit/ledger-money.unit.spec.ts tests/unit/ledger-core.unit.spec.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/ledger.ts frontend/tests/unit/ledger-money.unit.spec.ts
git commit -m "feat(ledger): credit/debit with idempotent replay + FIFO credit consumption

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: holds — reserve, settle, release

**Files:**
- Modify: `frontend/server/utils/ledger.ts`
- Test: `frontend/tests/unit/ledger-holds.unit.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–3 (exact signatures above); copies the `openTestDb()`/`ledgerWithUser()` helpers.
- Produces:

```ts
hold(userId: string, estimate: number, idempotencyKey: string):
  Promise<{ ok: true, holdId: number } | { ok: false, reason: 'insufficient' }>
settle(holdId: number, actual: number, reason: string): Promise<LedgerResult>
release(holdId: number): Promise<void>
```

Semantics (spec §5.2/§5.4): `hold` bumps `reserved_credits` after checking available. `settle` debits the ACTUAL amount (idempotency key `settle:<holdId>`), drops the reservation, marks the hold `settled`; an actual above the estimate is allowed even if it overdraws — the operator absorbs overruns and reconciliation flags them (never strand a completed provider job). `release` drops the reservation with no debit. Settle/release of a non-open hold is a no-op returning current state (webhooks retry).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/ledger-holds.unit.spec.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function ledgerWithUser(credits: number) {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  if (credits) await ledger.credit('u1', credits, 'topup', 'seed')
  return ledger
}

describe('ledger: holds', () => {
  it('hold reserves; available drops, balance does not', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'train:job1')
    expect(h.ok).toBe(true)
    expect(await l.getBalance('u1')).toBe(1000)
    expect(await l.getAvailable('u1')).toBe(400)
  })

  it('holds beyond available are rejected (concurrent holds cannot overspend)', async () => {
    const l = await ledgerWithUser(1000)
    await l.hold('u1', 600, 'job1')
    const second = await l.hold('u1', 600, 'job2')
    expect(second).toEqual({ ok: false, reason: 'insufficient' })
  })

  it('settle debits the actual amount and frees the reservation', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s = await l.settle(h.holdId, 450, 'training')
    expect(s).toEqual({ ok: true, balance: 550 })
    expect(await l.getAvailable('u1')).toBe(550) // reservation gone
  })

  it('settle above the estimate still debits (operator absorbs overrun)', async () => {
    const l = await ledgerWithUser(600)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s = await l.settle(h.holdId, 700, 'training')
    expect(s).toEqual({ ok: true, balance: -100 })
  })

  it('release frees the reservation with no debit; double release is a no-op', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    await l.release(h.holdId)
    await l.release(h.holdId)
    expect(await l.getBalance('u1')).toBe(1000)
    expect(await l.getAvailable('u1')).toBe(1000)
  })

  it('replayed hold key returns the same hold, reserving once', async () => {
    const l = await ledgerWithUser(1000)
    const h1 = await l.hold('u1', 600, 'job1')
    const h2 = await l.hold('u1', 600, 'job1')
    expect(h1).toEqual(h2)
    expect(await l.getAvailable('u1')).toBe(400)
  })

  it('settle after settle replays the original result', async () => {
    const l = await ledgerWithUser(1000)
    const h = await l.hold('u1', 600, 'job1')
    if (!h.ok) throw new Error('hold failed')
    const s1 = await l.settle(h.holdId, 450, 'training')
    const s2 = await l.settle(h.holdId, 450, 'training')
    expect(s1).toEqual(s2)
    expect(await l.getBalance('u1')).toBe(550)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger-holds.unit.spec.ts`
Expected: FAIL — `l.hold is not a function`.

- [ ] **Step 3: Implement holds inside `createLedger`**

```ts
  async function hold(
    userId: string, estimate: number, idempotencyKey: string,
  ): Promise<{ ok: true, holdId: number } | { ok: false, reason: 'insufficient' }> {
    assertAmount(estimate)
    await db.query('BEGIN')
    try {
      const existing = await db.query(
        `SELECT id FROM holds WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey])
      if (existing.rows.length) {
        await db.query('COMMIT')
        return { ok: true, holdId: Number(existing.rows[0].id) }
      }
      const { rows } = await db.query(
        `SELECT balance_credits, reserved_credits FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [userId])
      if (!rows.length) throw new Error(`ledger.hold: no wallet for ${userId} — call ensureUser first`)
      if (estimate > rows[0].balance_credits - rows[0].reserved_credits) {
        await db.query('ROLLBACK')
        return { ok: false, reason: 'insufficient' }
      }
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits + $2, updated_at = now()
         WHERE user_id = $1`, [userId, estimate])
      const ins = await db.query(
        `INSERT INTO holds (user_id, amount, idempotency_key) VALUES ($1, $2, $3) RETURNING id`,
        [userId, estimate, idempotencyKey])
      await db.query('COMMIT')
      return { ok: true, holdId: Number(ins.rows[0].id) }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  /** Load a hold row and lock it. Returns null if missing. */
  async function lockHold(holdId: number) {
    const { rows } = await db.query(
      `SELECT id, user_id, amount, state FROM holds WHERE id = $1 FOR UPDATE`, [holdId])
    return rows[0] ?? null
  }

  async function settle(holdId: number, actual: number, reason: string): Promise<LedgerResult> {
    assertAmount(actual)
    await db.query('BEGIN')
    try {
      const h = await lockHold(holdId)
      if (!h) throw new Error(`ledger.settle: hold ${holdId} not found`)
      if (h.state !== 'open') {
        // Replay: return the balance-after of the original settle debit.
        const replayed = await replayOf(h.user_id, 'debit', `settle:${holdId}`)
        await db.query('COMMIT')
        return replayed !== null
          ? { ok: true, balance: replayed }
          : { ok: true, balance: await getBalance(h.user_id) } // was released, no debit
      }
      // Drop the reservation, then debit the actual amount unconditionally:
      // the provider job already ran — overruns overdraw and reconciliation flags them.
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits - $2,
                            balance_credits = balance_credits - $3, updated_at = now()
         WHERE user_id = $1`, [h.user_id, h.amount, actual])
      const balance = await getBalance(h.user_id)
      await consumeFifo(h.user_id, actual)
      await db.query(
        `INSERT INTO ledger_entries (user_id, kind, amount, reason, idempotency_key, balance_after)
         VALUES ($1, 'debit', $2, $3, $4, $5)`,
        [h.user_id, actual, reason, `settle:${holdId}`, balance])
      await db.query(`UPDATE holds SET state = 'settled' WHERE id = $1`, [holdId])
      await db.query('COMMIT')
      return { ok: true, balance }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }

  async function release(holdId: number): Promise<void> {
    await db.query('BEGIN')
    try {
      const h = await lockHold(holdId)
      if (!h) throw new Error(`ledger.release: hold ${holdId} not found`)
      if (h.state !== 'open') { await db.query('COMMIT'); return } // idempotent no-op
      await db.query(
        `UPDATE wallets SET reserved_credits = reserved_credits - $2, updated_at = now()
         WHERE user_id = $1`, [h.user_id, h.amount])
      await db.query(`UPDATE holds SET state = 'released' WHERE id = $1`, [holdId])
      await db.query('COMMIT')
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }
```

Return object becomes: `{ ensureUser, getBalance, getAvailable, credit, debit, hold, settle, release }`.

- [ ] **Step 4: Run all ledger tests**

Run: `npx vitest run tests/unit/ledger-core.unit.spec.ts tests/unit/ledger-money.unit.spec.ts tests/unit/ledger-holds.unit.spec.ts`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/ledger.ts frontend/tests/unit/ledger-holds.unit.spec.ts
git commit -m "feat(ledger): hold/settle/release with reserved_credits and idempotent replay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: credit expiry — FIFO consumption + sweep

**Files:**
- Modify: `frontend/server/utils/ledger.ts`
- Test: `frontend/tests/unit/ledger-expiry.unit.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4; copies the harness helpers.
- Produces:

```ts
expireCredits(now?: string): Promise<{ expiredCredits: number }>
```

Semantics: expiry never silently mutates a balance — for each credit row with `remaining_credits > 0` and `expires_at <= now`, post a normal debit entry (`reason: 'expiry'`, idempotency key `expire:<entryId>`) for the remaining amount and zero the row's remaining. The ledger stays append-only and the wallet cache stays consistent. Designed for a later nightly cron; safe to call repeatedly.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/ledger-expiry.unit.spec.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'

const schema = readFileSync(
  fileURLToPath(new URL('../../server/db/schema.sql', import.meta.url)), 'utf8')

async function freshLedger() {
  const db = new PGlite()
  await db.exec(schema)
  const ledger = createLedger(db)
  await ledger.ensureUser('u1')
  return { db, ledger }
}

describe('ledger: expiry', () => {
  it('debits consume soonest-expiring credits first', async () => {
    const { db, ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'pack', 'k-pack')                                   // never expires
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.debit('u1', 80, 'generation', 'k-gen')
    const { rows } = await db.query(
      `SELECT reason, remaining_credits FROM ledger_entries
       WHERE kind = 'credit' AND user_id = 'u1' ORDER BY id`)
    expect(rows).toEqual([
      { reason: 'pack', remaining_credits: 100 },              // untouched
      { reason: 'subscription_grant', remaining_credits: 20 }, // consumed first
    ])
  })

  it('sweep expires leftover subscription credits, balance drops, pack survives', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'pack', 'k-pack')
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.debit('u1', 80, 'generation', 'k-gen') // 20 left on the grant
    const swept = await ledger.expireCredits('2026-09-02')
    expect(swept).toEqual({ expiredCredits: 20 })
    expect(await ledger.getBalance('u1')).toBe(100) // 200 - 80 - 20
  })

  it('sweep before the expiry date expires nothing', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    expect(await ledger.expireCredits('2026-08-31')).toEqual({ expiredCredits: 0 })
    expect(await ledger.getBalance('u1')).toBe(100)
  })

  it('sweep is idempotent — second run expires nothing more', async () => {
    const { ledger } = await freshLedger()
    await ledger.credit('u1', 100, 'subscription_grant', 'k-sub', { expiresAt: '2026-09-01' })
    await ledger.expireCredits('2026-09-02')
    expect(await ledger.expireCredits('2026-09-02')).toEqual({ expiredCredits: 0 })
    expect(await ledger.getBalance('u1')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger-expiry.unit.spec.ts`
Expected: the first test (FIFO order) PASSES already (Task 3 built consumeFifo); the three sweep tests FAIL — `ledger.expireCredits is not a function`. If the FIFO test fails, that is a Task-3 bug — fix it there first.

- [ ] **Step 3: Implement `expireCredits` inside `createLedger`**

```ts
  async function expireCredits(now?: string): Promise<{ expiredCredits: number }> {
    await db.query('BEGIN')
    try {
      const { rows } = await db.query(
        `SELECT id, user_id, remaining_credits FROM ledger_entries
         WHERE kind = 'credit' AND remaining_credits > 0
           AND expires_at IS NOT NULL AND expires_at <= $1
         ORDER BY user_id, id
         FOR UPDATE`, [now ?? new Date().toISOString()])
      let total = 0
      for (const row of rows) {
        // Lock the wallet, then post a normal expiry debit for the leftover.
        const w = await db.query(
          `UPDATE wallets SET balance_credits = balance_credits - $2, updated_at = now()
           WHERE user_id = $1 RETURNING balance_credits`, [row.user_id, row.remaining_credits])
        await db.query(
          `INSERT INTO ledger_entries (user_id, kind, amount, reason, idempotency_key, balance_after)
           VALUES ($1, 'debit', $2, 'expiry', $3, $4)`,
          [row.user_id, row.remaining_credits, `expire:${row.id}`, w.rows[0].balance_credits])
        await db.query(
          `UPDATE ledger_entries SET remaining_credits = 0 WHERE id = $1`, [row.id])
        total += row.remaining_credits
      }
      await db.query('COMMIT')
      return { expiredCredits: total }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    }
  }
```

Return object becomes: `{ ensureUser, getBalance, getAvailable, credit, debit, hold, settle, release, expireCredits }`.

- [ ] **Step 4: Run ALL ledger tests**

Run: `npx vitest run tests/unit/ledger-core.unit.spec.ts tests/unit/ledger-money.unit.spec.ts tests/unit/ledger-holds.unit.spec.ts tests/unit/ledger-expiry.unit.spec.ts`
Expected: PASS (18 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/ledger.ts frontend/tests/unit/ledger-expiry.unit.spec.ts
git commit -m "feat(ledger): credit expiry — expiring grants burn first, sweep posts expiry debits

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: observational spend log on the provider chokepoints

**Files:**
- Create: `frontend/server/utils/spendLog.ts`
- Modify: `frontend/server/utils/replicate.ts` (inside `runReplicate`)
- Modify: `frontend/server/utils/falRun.ts` (inside `runFal`)
- Test: `frontend/tests/unit/spend-log.unit.spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks (deliberately independent of the ledger — this is observation, not enforcement).
- Produces:

```ts
export interface SpendEvent {
  provider: 'replicate' | 'fal' | 'anthropic'
  model: string          // replicate model slug or fal app id
  ok: boolean            // did the provider job reach success
  ms?: number            // wall-clock from submit to terminal state
}
export function logSpend(event: SpendEvent): void   // fire-and-forget, NEVER throws
export function spendLogPath(): string              // resolved per call (env override for tests)
```

Log file: `.data/spend-events.jsonl` under `process.cwd()` (same `.data/` dir `secrets.ts` uses), one JSON object per line: `{ ts: ISO string, ...event }`. Override path with env `SAILOR_SPEND_LOG` (tests point it at a temp file). Known caveat: Anthropic calls are scattered across 10 routes with no shared runner — they are OUT of scope here (Stage 4 wraps them); the `'anthropic'` provider value exists so the type doesn't churn later.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spend-log.unit.spec.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { logSpend, spendLogPath } from '../../server/utils/spendLog'

const dir = mkdtempSync(join(tmpdir(), 'spend-log-'))
const logFile = join(dir, 'spend.jsonl')

afterEach(() => {
  delete process.env.SAILOR_SPEND_LOG
  rmSync(logFile, { force: true })
})

async function waitForFile(path: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (existsSync(path)) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error(`file never appeared: ${path}`)
}

describe('spendLog', () => {
  it('appends one JSON line per event with a timestamp', async () => {
    process.env.SAILOR_SPEND_LOG = logFile
    logSpend({ provider: 'replicate', model: 'black-forest-labs/flux-dev', ok: true, ms: 4200 })
    logSpend({ provider: 'fal', model: 'fal-ai/flux-pro/v1/fill', ok: false })
    await waitForFile(logFile)
    // both writes are async appends — poll until both lines land
    let lines: string[] = []
    for (let i = 0; i < 50 && lines.length < 2; i++) {
      lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      if (lines.length < 2) await new Promise(r => setTimeout(r, 20))
    }
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.provider).toBe('replicate')
    expect(first.model).toBe('black-forest-labs/flux-dev')
    expect(first.ok).toBe(true)
    expect(first.ms).toBe(4200)
    expect(new Date(first.ts).getTime()).toBeGreaterThan(0)
    expect(JSON.parse(lines[1]).ok).toBe(false)
  })

  it('respects the SAILOR_SPEND_LOG override', () => {
    process.env.SAILOR_SPEND_LOG = '/tmp/custom.jsonl'
    expect(spendLogPath()).toBe('/tmp/custom.jsonl')
  })

  it('never throws, even when the target directory is unwritable', () => {
    process.env.SAILOR_SPEND_LOG = '/nonexistent-root-dir/deep/spend.jsonl'
    expect(() => logSpend({ provider: 'fal', model: 'x', ok: true })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spend-log.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/spendLog`.

- [ ] **Step 3: Implement spendLog**

```ts
// frontend/server/utils/spendLog.ts
/**
 * Observational spend log (consumer-product roadmap, Stage-4 prep). Appends
 * one JSONL line per provider job so local usage produces the consumption
 * data the pricing decisions need. Observation only — it never gates and
 * NEVER throws: a logging failure must not break a paid render that already
 * succeeded. The ledger (ledger.ts) is enforcement; this is the flight recorder.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SpendEvent {
  provider: 'replicate' | 'fal' | 'anthropic'
  model: string
  ok: boolean
  ms?: number
}

export function spendLogPath(): string {
  return process.env.SAILOR_SPEND_LOG || join(process.cwd(), '.data', 'spend-events.jsonl')
}

export function logSpend(event: SpendEvent): void {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`
  const path = spendLogPath()
  void mkdir(dirname(path), { recursive: true })
    .then(() => appendFile(path, line, 'utf8'))
    .catch(() => {}) // fire-and-forget by design
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/spend-log.unit.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Instrument `runReplicate`**

In `frontend/server/utils/replicate.ts`, add the import at the top:

```ts
import { logSpend } from './spendLog'
```

Then in `runReplicate`, capture a start time right after the version lookup (line ~40, after `const version = await latestVersion(model, token)`):

```ts
  const startedAt = Date.now()
```

And replace the terminal block (currently lines 63–66):

```ts
  if (pred.status !== 'succeeded') {
    throw createError({ statusCode: 502, message: `Replicate prediction ${pred.status}: ${pred.error || 'unknown error'}` })
  }
  return pred.output
```

with:

```ts
  logSpend({ provider: 'replicate', model, ok: pred.status === 'succeeded', ms: Date.now() - startedAt })
  if (pred.status !== 'succeeded') {
    throw createError({ statusCode: 502, message: `Replicate prediction ${pred.status}: ${pred.error || 'unknown error'}` })
  }
  return pred.output
```

(Lookup/create failures before a prediction exists spend nothing and stay unlogged. The 504 timeout path also stays unlogged — no terminal state was observed.)

- [ ] **Step 6: Instrument `runFal`**

In `frontend/server/utils/falRun.ts`, add the import at the top (below the `getFalToken` import):

```ts
import { logSpend } from './spendLog'
```

In `runFal`, capture a start time right after the submit response is parsed (after `const submit = await submitRes.json() as FalSubmit`):

```ts
  const startedAt = Date.now()
```

Then in the polling loop, replace the COMPLETED branch and the terminal-failure throw (currently lines 64–72):

```ts
    if (status.status === 'COMPLETED') {
      const rRes = await fetch(resultUrl, { headers })
      if (!rRes.ok) {
        const t = await rRes.text().catch(() => '')
        throw new Error(`fal result ${rRes.status}: ${t}`)
      }
      return await rRes.json() as T
    }
    throw new Error(`fal request ${rid} ended in ${status.status}: ${JSON.stringify(status)}`)
```

with:

```ts
    if (status.status === 'COMPLETED') {
      logSpend({ provider: 'fal', model: app, ok: true, ms: Date.now() - startedAt })
      const rRes = await fetch(resultUrl, { headers })
      if (!rRes.ok) {
        const t = await rRes.text().catch(() => '')
        throw new Error(`fal result ${rRes.status}: ${t}`)
      }
      return await rRes.json() as T
    }
    logSpend({ provider: 'fal', model: app, ok: false, ms: Date.now() - startedAt })
    throw new Error(`fal request ${rid} ended in ${status.status}: ${JSON.stringify(status)}`)
```

- [ ] **Step 7: Verify nothing broke**

Run: `npx vitest run tests/unit/spend-log.unit.spec.ts tests/unit/inpaint-fal-fill-prompt.unit.spec.ts`
Expected: PASS. Also run `npx nuxt typecheck 2>&1 | grep -E 'spendLog|replicate\.ts|falRun\.ts'` — expected: no output (no new type errors in the touched files; the repo has a large pre-existing baseline, ignore everything else).

- [ ] **Step 8: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/server/utils/spendLog.ts frontend/server/utils/replicate.ts \
  frontend/server/utils/falRun.ts frontend/tests/unit/spend-log.unit.spec.ts
git commit -m "feat(metering): observational spend log on the replicate + fal chokepoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of scope (explicitly)

- Clerk middleware, auth pages, Neon connection wiring — need vendor accounts (roadmap Stage 1 proper).
- Swapping `mockLedger` callers (`/api/meter/prompt`) to the real ledger — pointless until a real DB exists at runtime.
- Anthropic call instrumentation — 10 scattered fetch sites, no shared runner; Stage 4 work.
- Credit *pricing* of spend-log events — the log records provider/model/duration; the price book maps them later.
