# Stage 1 — Clerk Auth + User Sync + Live-Ledger Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plain-language summary (standing rule):** Today anyone who can reach the server can use every paid feature, and "who is signed in" doesn't exist. After this plan: in hosted mode every API request must carry a valid Clerk login, a new user automatically gets a row in the database, a wallet, and a small welcome credit, and the graph-run meter charges the *real* wallet instead of a toy one. On Julien's own machine nothing changes at all — no login, no meter, exactly today's behavior.

**Goal:** Hosted-mode requests are authenticated by Clerk on every `/api/**` and proxied ComfyUI path; users sync into Neon with a signup bonus; the meter route debits the real ledger. Local mode is bit-for-bit today's behavior.

**Architecture:** A pure `guardDecision()` module decides pass/attach/reject per path (unit-tested); a thin Nitro middleware (`auth.ts`, runs before `comfyui-proxy.ts` by filename order) applies it using Clerk's `event.context.auth()`. User sync is one idempotent function (`ensureUserWithBonus`) called from both the Clerk webhook and a lazy first-request fallback — the ledger's idempotency keys make double-calls safe. The meter route builds its deps from a factory that picks mock (local) or real ledger (hosted).

**Tech Stack:** Nuxt 4 / Nitro, `@clerk/nuxt` 3.x (`event.context.auth()`, `verifyWebhook`), pg via existing `server/utils/ledgerDb.ts`, PGlite for unit tests, vitest.

## Global Constraints

- **deployMode contract (non-negotiable):** no `NUXT_CLERK_SECRET_KEY` in env ⇒ local mode ⇒ exactly today's behavior. The `@clerk/nuxt` module is only loaded in hosted mode (conditional in `nuxt.config.ts` — already landed, do not change).
- `server/utils/deployMode.ts` reads `process.env` per call — never cache mode at module level (import-order gotcha).
- Ledger contract: one dedicated DB session per `createLedger` handle; NEVER wrap `getBalance`/`getAvailable` in the tx mutex; idempotency prefixes `settle:`/`expire:` reserved.
- Signup bonus is **provisionally 200 credits ($2)** — single constant, flagged for the pricing call (gap 28).
- Colour conventions: action blue is the only accent; use `StudioButton` for action buttons; purple banned.
- New `/api/*` prefixes must be allowlisted in `server/middleware/comfyui-proxy.ts` (`NITRO_API_PATHS`/`NITRO_API_PREFIXES`) or they get proxied to ComfyUI.
- Run unit tests from `frontend/`: `npx vitest run <file>`.
- Commits: main-direct, stage ONLY your own files (parallel sessions active), end commit messages with the Claude Fable co-author line.

---

### Task 1: Pure auth guard + shared proxy path list

**Files:**
- Create: `frontend/server/utils/authGuard.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts:7-24` (import PROXY_PREFIXES instead of defining it)
- Test: `frontend/tests/unit/auth-guard.unit.spec.ts`

**Interfaces:**
- Consumes: `deployMode()` type (`'local' | 'hosted'`) from `server/utils/deployMode.ts` (passed in as a param — the pure fn never reads env).
- Produces:
  - `PROXY_PREFIXES: string[]` (moved here verbatim from comfyui-proxy.ts)
  - `PUBLIC_API_PATHS: string[]`
  - `type GuardDecision = { kind: 'pass' } | { kind: 'attach'; userId: string } | { kind: 'reject' }`
  - `guardDecision(path: string, mode: 'local' | 'hosted', userId: string | null): GuardDecision`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/auth-guard.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { guardDecision, PROXY_PREFIXES, PUBLIC_API_PATHS } from '../../server/utils/authGuard'

describe('guardDecision', () => {
  it('local mode passes everything untouched (the deployMode contract)', () => {
    expect(guardDecision('/api/meter/prompt', 'local', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/prompt', 'local', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/anything', 'local', 'user_1')).toEqual({ kind: 'pass' })
  })

  it('hosted mode rejects unauthenticated guarded paths', () => {
    expect(guardDecision('/api/meter/prompt', 'hosted', null)).toEqual({ kind: 'reject' })
    expect(guardDecision('/prompt', 'hosted', null)).toEqual({ kind: 'reject' })   // proxied engine path
    expect(guardDecision('/view?filename=x.png', 'hosted', null)).toEqual({ kind: 'reject' })
    expect(guardDecision('/api', 'hosted', null)).toEqual({ kind: 'reject' })      // bare prefix counts
  })

  it('hosted mode attaches the user on guarded paths', () => {
    expect(guardDecision('/api/wallet', 'hosted', 'user_1')).toEqual({ kind: 'attach', userId: 'user_1' })
    expect(guardDecision('/queue', 'hosted', 'user_1')).toEqual({ kind: 'attach', userId: 'user_1' })
  })

  it('hosted mode passes public API paths and non-guarded paths', () => {
    expect(guardDecision('/api/webhooks/clerk', 'hosted', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/', 'hosted', null)).toEqual({ kind: 'pass' })            // app page
    expect(guardDecision('/sign-in', 'hosted', null)).toEqual({ kind: 'pass' })     // Clerk pages
    expect(guardDecision('/_nuxt/foo.js', 'hosted', null)).toEqual({ kind: 'pass' })
  })

  it('prefix matching is boundary-aware, not raw startsWith', () => {
    // '/apiFOO' must NOT match the '/api' prefix; '/promptly' must not match '/prompt'
    expect(guardDecision('/apiFOO', 'hosted', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/promptly', 'hosted', null)).toEqual({ kind: 'pass' })
  })

  it('exports the proxy prefix list for the proxy middleware to share', () => {
    expect(PROXY_PREFIXES).toContain('/api')
    expect(PROXY_PREFIXES).toContain('/prompt')
    expect(PUBLIC_API_PATHS).toContain('/api/webhooks/clerk')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth-guard.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/authGuard`

- [ ] **Step 3: Implement `authGuard.ts`**

```ts
// frontend/server/utils/authGuard.ts
/**
 * Pure request-guard decisions for hosted mode (accounts spec §5.1). The
 * middleware (server/middleware/auth.ts) supplies path/mode/userId and acts
 * on the decision; this module never reads env or the event so it stays
 * unit-testable without a Nitro harness.
 *
 * PROXY_PREFIXES is THE canonical list of engine paths — comfyui-proxy.ts
 * imports it from here so the guard and the proxy can never drift.
 */

// Prefixes to proxy (without trailing slashes — matching uses boundary-aware startsWith)
export const PROXY_PREFIXES = [
  '/comfyui',
  '/extensions',
  '/api',
  '/queue',
  '/prompt',
  '/interrupt',
  '/history',
  '/system_stats',
  '/view',
  '/upload',
  '/object_info',
  '/global_subgraphs',
  '/gate',
  '/sailor',
]

/** API paths reachable without a session: signed webhooks only. */
export const PUBLIC_API_PATHS = ['/api/webhooks/clerk']

export type GuardDecision =
  | { kind: 'pass' }
  | { kind: 'attach'; userId: string }
  | { kind: 'reject' }

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix
    || path.startsWith(prefix + '/')
    || path.startsWith(prefix + '?')
}

export function guardDecision(
  path: string,
  mode: 'local' | 'hosted',
  userId: string | null,
): GuardDecision {
  if (mode === 'local') return { kind: 'pass' }
  if (PUBLIC_API_PATHS.some(p => matchesPrefix(path, p))) return { kind: 'pass' }
  const guarded = PROXY_PREFIXES.some(p => matchesPrefix(path, p))
  if (!guarded) return { kind: 'pass' }
  if (userId) return { kind: 'attach', userId }
  return { kind: 'reject' }
}
```

- [ ] **Step 4: Point comfyui-proxy at the shared list**

In `frontend/server/middleware/comfyui-proxy.ts`, delete the local `const PROXY_PREFIXES = [ ... ]` block (lines 7–24) and add at the top of the imports:

```ts
import { PROXY_PREFIXES } from '../utils/authGuard'
```

Keep everything else in the file identical.

- [ ] **Step 5: Run tests + typecheck the touched files**

Run: `npx vitest run tests/unit/auth-guard.unit.spec.ts`
Expected: PASS (6 tests)

Run: `npx tsc --noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler server/utils/authGuard.ts`
Expected: exit 0

- [ ] **Step 6: Verify the running dev server still proxies (local mode unchanged)**

Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/ai-status`
Expected: `200` (if the dev server isn't running, note it and skip — do NOT start one)

- [ ] **Step 7: Commit**

```bash
git add server/utils/authGuard.ts server/middleware/comfyui-proxy.ts tests/unit/auth-guard.unit.spec.ts
git commit -m "feat(hosted): pure auth guard + shared proxy path list (Stage 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Live ledger singleton + idempotent user sync with signup bonus

**Files:**
- Create: `frontend/server/utils/ledgerLive.ts`
- Create: `frontend/server/utils/userSync.ts`
- Test: `frontend/tests/unit/user-sync.unit.spec.ts`

**Interfaces:**
- Consumes: `createLedger(db)` from `server/utils/ledger.ts` (returns `{ ensureUser, credit, debit, getBalance, getAvailable, hold, settle, release, expireCredits }`, all async); `getSharedLedgerDb()` from `server/utils/ledgerDb.ts`; `LedgerDb` type.
- Produces:
  - `getLiveLedger(): ReturnType<typeof createLedger>` — process-wide singleton over the shared Neon session (hosted mode only; throws without `DATABASE_URL`).
  - `SIGNUP_BONUS_CREDITS = 200`
  - `ensureUserWithBonus(ledger: ReturnType<typeof createLedger>, db: LedgerDb, userId: string, email?: string | null): Promise<void>` — idempotent; safe to call from webhook AND lazy fallback concurrently.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/user-sync.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createLedger } from '../../server/utils/ledger'
import { ensureUserWithBonus, SIGNUP_BONUS_CREDITS } from '../../server/utils/userSync'

async function openTestDb() {
  const db = new PGlite()
  const schema = readFileSync(join(__dirname, '../../server/db/schema.sql'), 'utf8')
  await db.exec(schema)
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params as any[]) }
}

describe('ensureUserWithBonus', () => {
  it('creates user + wallet and grants the signup bonus exactly once', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await ensureUserWithBonus(ledger, db, 'user_a', 'a@example.com')
    expect(await ledger.getBalance('user_a')).toBe(SIGNUP_BONUS_CREDITS)

    // Called again (webhook + lazy fallback both fire): still exactly one bonus
    await ensureUserWithBonus(ledger, db, 'user_a', 'a@example.com')
    expect(await ledger.getBalance('user_a')).toBe(SIGNUP_BONUS_CREDITS)

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1 AND reason = 'signup_bonus'`,
      ['user_a'])
    expect(rows[0].n).toBe(1)
  })

  it('records the email on the user row and backfills it if first sync had none', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await ensureUserWithBonus(ledger, db, 'user_b', null)
    await ensureUserWithBonus(ledger, db, 'user_b', 'b@example.com')
    const { rows } = await db.query(`SELECT email FROM users WHERE id = $1`, ['user_b'])
    expect(rows[0].email).toBe('b@example.com')
  })

  it('concurrent calls do not double-grant (idempotency under the mutex)', async () => {
    const db = await openTestDb()
    const ledger = createLedger(db)
    await Promise.all([
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
      ensureUserWithBonus(ledger, db, 'user_c', 'c@example.com'),
    ])
    expect(await ledger.getBalance('user_c')).toBe(SIGNUP_BONUS_CREDITS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/user-sync.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/userSync`

- [ ] **Step 3: Implement `userSync.ts` and `ledgerLive.ts`**

```ts
// frontend/server/utils/userSync.ts
/**
 * Identity sync (accounts spec §5.1): Clerk user → users row + wallet +
 * one-time signup bonus. Called from BOTH the Clerk webhook (user.created)
 * and the auth middleware's lazy first-request fallback — webhooks can lag
 * or arrive twice, so the whole operation must be idempotent. It is: user
 * and wallet inserts are ON CONFLICT DO NOTHING (inside ledger.ensureUser),
 * and the bonus credit's idempotency key `signup:<userId>` makes the ledger
 * replay it as a no-op on any repeat.
 */
import type { LedgerDb } from './ledger'
import type { createLedger } from './ledger'

/** PROVISIONAL until the pricing call (roadmap gap 28) — $2 of credits. */
export const SIGNUP_BONUS_CREDITS = 200

export async function ensureUserWithBonus(
  ledger: ReturnType<typeof createLedger>,
  db: LedgerDb,
  userId: string,
  email?: string | null,
): Promise<void> {
  await ledger.ensureUser(userId)
  if (email) {
    await db.query(
      `UPDATE users SET email = $2 WHERE id = $1 AND (email IS NULL OR email <> $2)`,
      [userId, email])
  }
  await ledger.credit(userId, SIGNUP_BONUS_CREDITS, 'signup_bonus', `signup:${userId}`)
}
```

```ts
// frontend/server/utils/ledgerLive.ts
/**
 * The hosted-mode ledger: one createLedger instance over the one shared
 * Neon session (ledgerDb.ts). All hosted callers MUST go through this —
 * multiple ledger instances on one session can interleave transactions
 * (see the concurrency contract in ledger.ts).
 */
import { createLedger } from './ledger'
import { getSharedLedgerDb } from './ledgerDb'

let live: ReturnType<typeof createLedger> | null = null

export function getLiveLedger(): ReturnType<typeof createLedger> {
  if (!live) live = createLedger(getSharedLedgerDb())
  return live
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/user-sync.unit.spec.ts`
Expected: PASS (3 tests)

Run: `npx vitest run tests/unit/ledger-core.unit.spec.ts`
Expected: PASS (regression: ledger untouched, but prove it)

- [ ] **Step 5: Commit**

```bash
git add server/utils/userSync.ts server/utils/ledgerLive.ts tests/unit/user-sync.unit.spec.ts
git commit -m "feat(hosted): live-ledger singleton + idempotent user sync with signup bonus

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The auth middleware

**Files:**
- Create: `frontend/server/middleware/auth.ts`
- Test: `frontend/tests/unit/auth-middleware-helpers.unit.spec.ts`

**Interfaces:**
- Consumes: `guardDecision`, `deployMode()`, `ensureUserWithBonus`, `getLiveLedger`, `getSharedLedgerDb`. Clerk's module middleware (hosted only) sets `event.context.auth` — an `AuthFn`; `event.context.auth({ acceptsToken: 'session_token' })` is NOT needed; plain `event.context.auth()` returns `{ userId: string | null, ... }`.
- Produces: `event.context.userId: string` on authenticated hosted requests (the spec §5.1 contract downstream routes rely on). Exports `resolveClerkUserId(event): string | null` and `shouldLazySync(userId: string): boolean` for tests.

**Ordering fact:** Nitro runs `server/middleware/*` in filename order — `auth.ts` sorts before `comfyui-proxy.ts`, so the guard runs before any proxying. Do not rename either file.

- [ ] **Step 1: Write the failing test (pure helpers only — no Nitro harness exists)**

```ts
// frontend/tests/unit/auth-middleware-helpers.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { resolveClerkUserId, shouldLazySync, __resetLazySyncForTests } from '../../server/middleware/auth'

describe('resolveClerkUserId', () => {
  it('reads userId from a Clerk auth context', () => {
    const event = { context: { auth: () => ({ userId: 'user_1' }) } }
    expect(resolveClerkUserId(event as any)).toBe('user_1')
  })
  it('returns null when Clerk middleware is absent (local mode) or anonymous', () => {
    expect(resolveClerkUserId({ context: {} } as any)).toBeNull()
    const anon = { context: { auth: () => ({ userId: null }) } }
    expect(resolveClerkUserId(anon as any)).toBeNull()
  })
  it('returns null when auth() throws (malformed token)', () => {
    const bad = { context: { auth: () => { throw new Error('bad token') } } }
    expect(resolveClerkUserId(bad as any)).toBeNull()
  })
})

describe('shouldLazySync', () => {
  it('is true once per user per process, then false', () => {
    __resetLazySyncForTests()
    expect(shouldLazySync('user_x')).toBe(true)
    expect(shouldLazySync('user_x')).toBe(false)
    expect(shouldLazySync('user_y')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth-middleware-helpers.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/middleware/auth`

- [ ] **Step 3: Implement the middleware**

```ts
// frontend/server/middleware/auth.ts
/**
 * Hosted-mode session guard (accounts spec §5.1). Runs BEFORE
 * comfyui-proxy.ts (filename order) so every proxied engine path is guarded
 * too. Local mode: guardDecision passes everything — zero behavior change.
 *
 * On the first authenticated request a process sees for a user, lazily
 * ensure the user row + wallet + signup bonus exist (covers Clerk-webhook
 * lag; ensureUserWithBonus is idempotent so webhook + lazy racing is safe).
 * The lazy sync must never block or fail the request — sync errors are
 * logged and retried on a later request.
 */
import { deployMode } from '../utils/deployMode'
import { guardDecision } from '../utils/authGuard'
import { ensureUserWithBonus } from '../utils/userSync'
import { getLiveLedger } from '../utils/ledgerLive'
import { getSharedLedgerDb } from '../utils/ledgerDb'
import type { H3Event } from 'h3'

export function resolveClerkUserId(event: H3Event): string | null {
  const auth = (event.context as any).auth
  if (typeof auth !== 'function') return null
  try {
    const a = auth()
    return a?.userId ?? null
  } catch {
    return null
  }
}

// Per-process memo so the lazy sync runs once per user, not per request.
// Misses are cheap (ensureUserWithBonus is idempotent); a process restart
// simply re-runs one no-op sync per user.
let lazySynced = new Set<string>()
export function shouldLazySync(userId: string): boolean {
  if (lazySynced.has(userId)) return false
  lazySynced.add(userId)
  return true
}
export function __resetLazySyncForTests(): void { lazySynced = new Set() }

export default defineEventHandler((event) => {
  const mode = deployMode()
  if (mode === 'local') return

  const path = event.path ?? ''
  const userId = resolveClerkUserId(event)
  const decision = guardDecision(path, mode, userId)

  if (decision.kind === 'reject') {
    throw createError({ statusCode: 401, message: 'Sign in required' })
  }
  if (decision.kind === 'attach') {
    event.context.userId = decision.userId
    if (shouldLazySync(decision.userId)) {
      void ensureUserWithBonus(getLiveLedger(), getSharedLedgerDb(), decision.userId)
        .catch((e) => {
          console.error('[auth] lazy user sync failed for', decision.userId, e)
          lazySynced.delete(decision.userId) // retry on a later request
        })
    }
  }
})
```

Also extend Nitro's typed context — append to the bottom of the file:

```ts
declare module 'h3' {
  interface H3EventContext {
    userId?: string
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/auth-middleware-helpers.unit.spec.ts`
Expected: PASS (4 tests)

Run: `npx tsc --noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler server/middleware/auth.ts` — this WILL fail on `defineEventHandler`/`createError` (Nitro auto-imports, not resolvable standalone). That standalone failure is acceptable; instead verify via the running dev server:

Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/ai-status`
Expected: `200` — local mode passes through the new middleware untouched.

- [ ] **Step 5: Broken-control check on the local-mode gate**

Temporarily change `if (mode === 'local') return` to `if (false && mode === 'local') return`, wait ~3s for HMR, re-run the curl. Expected: still `200` **because guardDecision('…','local',…) also passes** — then ALSO temporarily hardcode `const mode = 'hosted' as const` and re-run: expected `401`. Revert both edits, confirm `200` again. This proves the middleware actually intercepts and rejects when armed.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/auth.ts tests/unit/auth-middleware-helpers.unit.spec.ts
git commit -m "feat(hosted): Clerk session middleware guarding /api/** + proxied engine paths

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Clerk webhook route

**Files:**
- Create: `frontend/server/api/webhooks/clerk.post.ts`
- Create: `frontend/server/utils/clerkEvents.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` — add `'/api/webhooks'` to `NITRO_API_PREFIXES`
- Test: `frontend/tests/unit/clerk-events.unit.spec.ts`

**Interfaces:**
- Consumes: `verifyWebhook(event)` from `@clerk/nuxt/webhooks` (Svix-verifies using `CLERK_WEBHOOK_SIGNING_SECRET` env; returns a typed `WebhookEvent` with `.type` and `.data`); `ensureUserWithBonus`; `getLiveLedger`; `getSharedLedgerDb`; `isHosted()`.
- Produces: `handleClerkEvent(evt: { type: string; data: any }, deps: { sync: (userId: string, email: string | null) => Promise<void> }): Promise<{ handled: boolean }>` in `clerkEvents.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/clerk-events.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { handleClerkEvent } from '../../server/utils/clerkEvents'

describe('handleClerkEvent', () => {
  it('user.created syncs the user with their primary email', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const evt = {
      type: 'user.created',
      data: {
        id: 'user_123',
        primary_email_address_id: 'idn_1',
        email_addresses: [
          { id: 'idn_0', email_address: 'other@example.com' },
          { id: 'idn_1', email_address: 'primary@example.com' },
        ],
      },
    }
    const res = await handleClerkEvent(evt, { sync })
    expect(res.handled).toBe(true)
    expect(sync).toHaveBeenCalledWith('user_123', 'primary@example.com')
  })

  it('user.created with no email still syncs (email null)', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const res = await handleClerkEvent(
      { type: 'user.created', data: { id: 'user_9', email_addresses: [] } }, { sync })
    expect(res.handled).toBe(true)
    expect(sync).toHaveBeenCalledWith('user_9', null)
  })

  it('other event types are acknowledged but not handled', async () => {
    const sync = vi.fn()
    const res = await handleClerkEvent({ type: 'session.created', data: { id: 'sess_1' } }, { sync })
    expect(res.handled).toBe(false)
    expect(sync).not.toHaveBeenCalled()
  })

  it('user.created without an id is rejected', async () => {
    const sync = vi.fn()
    await expect(handleClerkEvent({ type: 'user.created', data: {} }, { sync }))
      .rejects.toThrow(/user id/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clerk-events.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/clerkEvents`

- [ ] **Step 3: Implement `clerkEvents.ts` and the route**

```ts
// frontend/server/utils/clerkEvents.ts
/**
 * Clerk webhook event handling (accounts spec §5.1), separated from the
 * route so it unit-tests without Svix signatures. Only user.created is
 * acted on today; everything else is acknowledged (200) so Clerk does not
 * retry events we deliberately ignore.
 */
export interface ClerkEventDeps {
  sync: (userId: string, email: string | null) => Promise<void>
}

export async function handleClerkEvent(
  evt: { type: string; data: any },
  deps: ClerkEventDeps,
): Promise<{ handled: boolean }> {
  if (evt.type !== 'user.created') return { handled: false }
  const id = evt.data?.id
  if (typeof id !== 'string' || !id) throw new Error('clerk webhook: user.created without a user id')
  const emails: Array<{ id?: string; email_address?: string }> = evt.data?.email_addresses ?? []
  const primary = emails.find(e => e.id === evt.data?.primary_email_address_id) ?? emails[0]
  await deps.sync(id, primary?.email_address ?? null)
  return { handled: true }
}
```

```ts
// frontend/server/api/webhooks/clerk.post.ts
/**
 * Clerk → Sailor user sync (accounts spec §5.1). Svix-verified via
 * @clerk/nuxt's verifyWebhook (CLERK_WEBHOOK_SIGNING_SECRET env). The
 * signature is the auth — this path is in PUBLIC_API_PATHS, no session.
 * Hosted mode only: local mode has no Clerk and must not expose it.
 */
import { verifyWebhook } from '@clerk/nuxt/webhooks'
import { isHosted } from '~~/server/utils/deployMode'
import { handleClerkEvent } from '~~/server/utils/clerkEvents'
import { ensureUserWithBonus } from '~~/server/utils/userSync'
import { getLiveLedger } from '~~/server/utils/ledgerLive'
import { getSharedLedgerDb } from '~~/server/utils/ledgerDb'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })

  let evt: { type: string; data: any }
  try {
    evt = await verifyWebhook(event) as any
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid webhook signature' })
  }

  const result = await handleClerkEvent(evt, {
    sync: (userId, email) => ensureUserWithBonus(getLiveLedger(), getSharedLedgerDb(), userId, email),
  })
  return { ok: true, handled: result.handled }
})
```

- [ ] **Step 4: Allowlist the webhook prefix in the proxy**

In `frontend/server/middleware/comfyui-proxy.ts`, add `'/api/webhooks'` to the FRONT of `NITRO_API_PREFIXES` (same single-line style as `/api/admin` was added).

- [ ] **Step 5: Run tests; verify local-mode 404**

Run: `npx vitest run tests/unit/clerk-events.unit.spec.ts`
Expected: PASS (4 tests)

Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X POST http://127.0.0.1:3000/api/webhooks/clerk`
Expected: `404` (local mode hides the route; also proves the allowlist works — a proxied miss would be a ComfyUI error, not our 404)

- [ ] **Step 6: Commit**

```bash
git add server/api/webhooks/clerk.post.ts server/utils/clerkEvents.ts server/middleware/comfyui-proxy.ts tests/unit/clerk-events.unit.spec.ts
git commit -m "feat(hosted): Clerk user.created webhook -> idempotent user sync

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wallet endpoint

**Files:**
- Create: `frontend/server/api/wallet.get.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` — add `'/api/wallet'` to `NITRO_API_PATHS`
- Test: `frontend/tests/unit/wallet-route-shape.unit.spec.ts`

**Interfaces:**
- Consumes: `event.context.userId` (set by Task 3's middleware), `getLiveLedger()`, `isHosted()`.
- Produces: `GET /api/wallet` → hosted + authed: `{ mode: 'hosted', balance: number, available: number }`; local: `{ mode: 'local' }`. Also exports `walletPayload(mode, userId, ledger)` for tests.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/wallet-route-shape.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { walletPayload } from '../../server/api/wallet.get'

const fakeLedger = {
  getBalance: async (_u: string) => 700,
  getAvailable: async (_u: string) => 500,
} as any

describe('walletPayload', () => {
  it('local mode reports local with no numbers', async () => {
    expect(await walletPayload('local', null, fakeLedger)).toEqual({ mode: 'local' })
  })
  it('hosted + user returns balance and available', async () => {
    expect(await walletPayload('hosted', 'user_1', fakeLedger))
      .toEqual({ mode: 'hosted', balance: 700, available: 500 })
  })
  it('hosted without a user throws 401-shaped error', async () => {
    await expect(walletPayload('hosted', null, fakeLedger)).rejects.toMatchObject({ statusCode: 401 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/wallet-route-shape.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/api/wallet.get`

- [ ] **Step 3: Implement**

```ts
// frontend/server/api/wallet.get.ts
/**
 * The signed-in user's wallet (balance + available = balance − open holds).
 * Local mode reports { mode: 'local' } so the client renders no wallet UI.
 */
import { deployMode } from '~~/server/utils/deployMode'
import { getLiveLedger } from '~~/server/utils/ledgerLive'

interface WalletLedger {
  getBalance(userId: string): Promise<number>
  getAvailable(userId: string): Promise<number>
}

export async function walletPayload(
  mode: 'local' | 'hosted',
  userId: string | null,
  ledger: WalletLedger,
): Promise<{ mode: 'local' } | { mode: 'hosted'; balance: number; available: number }> {
  if (mode === 'local') return { mode: 'local' }
  if (!userId) {
    const err: any = new Error('Sign in required')
    err.statusCode = 401
    throw err
  }
  const [balance, available] = await Promise.all([
    ledger.getBalance(userId),
    ledger.getAvailable(userId),
  ])
  return { mode: 'hosted', balance, available }
}

export default defineEventHandler(async (event) => {
  const mode = deployMode()
  return walletPayload(
    mode,
    event.context.userId ?? null,
    mode === 'hosted' ? getLiveLedger() : (null as never),
  )
})
```

(Note: `getLiveLedger()` is only called in hosted mode — calling it in local mode would throw on missing `DATABASE_URL`, which is why the ternary guards it.)

- [ ] **Step 4: Allowlist + run tests + local probe**

Add `'/api/wallet'` to `NITRO_API_PATHS` in `comfyui-proxy.ts`.

Run: `npx vitest run tests/unit/wallet-route-shape.unit.spec.ts`
Expected: PASS (3 tests)

Run: `curl -s --max-time 20 http://127.0.0.1:3000/api/wallet`
Expected: `{"mode":"local"}`

- [ ] **Step 5: Commit**

```bash
git add server/api/wallet.get.ts server/middleware/comfyui-proxy.ts tests/unit/wallet-route-shape.unit.spec.ts
git commit -m "feat(hosted): /api/wallet balance endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Meter route onto the real ledger

**Files:**
- Create: `frontend/server/utils/meterWiring.ts`
- Modify: `frontend/server/utils/meterPrompt.ts:21-40` (allow async `getAvailable`)
- Modify: `frontend/server/api/meter/prompt.post.ts` (use the wiring factory)
- Test: `frontend/tests/unit/meter-wiring.unit.spec.ts`

**Interfaces:**
- Consumes: `MeterDeps` from `meterPrompt.ts` (fields: `priceGraph`, `getAvailable`, `register`, `forward`, `settle`); `mockLedger` (sync methods) from `mockLedger.ts`; `getLiveLedger()` (async methods); `meterStore.register/resolve`; `settleOnCompletion`.
- Produces: `buildLedgerAdapters(mode: 'local' | 'hosted', live?: { getAvailable(u: string): Promise<number>; debit(u: string, amount: number, reason: string, key: string): Promise<{ ok: boolean }> }): { getAvailable(u: string): number | Promise<number>; debitOnSuccess(u: string, credits: number, version: string, promptId: string): Promise<{ ok: boolean }> }` — the ONLY mode-dependent parts of the meter deps. The route keeps owning `forward`/`register`/`settle` wiring.

- [ ] **Step 1: Make `MeterDeps.getAvailable` async-friendly**

In `frontend/server/utils/meterPrompt.ts`, change the `MeterDeps` field
`getAvailable: (userId: string) => number` to
`getAvailable: (userId: string) => number | Promise<number>` and change the call site
`const available = deps.getAvailable(userId)` to
`const available = await deps.getAvailable(userId)`.

Run: `npx vitest run tests/unit/` filtered to existing meter tests: `npx vitest run tests/unit --testNamePattern=meter` — expected: all existing meter tests still PASS (plain numbers await fine).
(If no meter tests exist under that name, run the full unit dir and confirm no new failures vs. before the edit.)

- [ ] **Step 2: Write the failing test for the adapters**

```ts
// frontend/tests/unit/meter-wiring.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { buildLedgerAdapters } from '../../server/utils/meterWiring'
import { mockLedger } from '../../server/utils/mockLedger'

describe('buildLedgerAdapters', () => {
  it('local mode reads and debits the mock ledger', async () => {
    const a = buildLedgerAdapters('local')
    mockLedger.reset?.()
    mockLedger.credit('u1', 100, 'seed', 'k0')
    expect(await a.getAvailable('u1')).toBe(100)
    const r = await a.debitOnSuccess('u1', 40, 'v1', 'prompt-1')
    expect(r.ok).toBe(true)
    expect(await a.getAvailable('u1')).toBe(60)
  })

  it('hosted mode uses the injected live ledger with graph_run reason + promptId key', async () => {
    const live = {
      getAvailable: vi.fn().mockResolvedValue(250),
      debit: vi.fn().mockResolvedValue({ ok: true, balance: 210 }),
    }
    const a = buildLedgerAdapters('hosted', live)
    expect(await a.getAvailable('u2')).toBe(250)
    await a.debitOnSuccess('u2', 40, 'v2', 'prompt-9')
    expect(live.debit).toHaveBeenCalledWith('u2', 40, 'graph_run:v2', 'prompt-9')
  })

  it('hosted mode without a live ledger is a hard error (no silent mock fallback)', () => {
    expect(() => buildLedgerAdapters('hosted')).toThrow(/live ledger/i)
  })
})
```

Note: if `mockLedger` has no `reset()`, use a fresh user id (`'u1-' + Date.now()` is banned in workflows but fine in vitest) — or just pick a unique const string per test run; adjust the assertion to relative amounts. Inspect `mockLedger.ts` first and match its real API — the test above must compile against the actual mock.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/meter-wiring.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/meterWiring`

- [ ] **Step 4: Implement `meterWiring.ts`**

```ts
// frontend/server/utils/meterWiring.ts
/**
 * The mode-dependent half of the meter deps: where balances are read and
 * where the success debit lands. Local = in-memory mockLedger (spike
 * behavior, unchanged). Hosted = the real Neon ledger. Hosted with no live
 * ledger is a HARD error — a silent mock fallback would run paid jobs
 * against a toy wallet (graceful-fallback-hides-integration-failure).
 */
import { mockLedger } from './mockLedger'

export interface LiveLedgerSlice {
  getAvailable(userId: string): Promise<number>
  debit(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<{ ok: boolean }>
}

export interface LedgerAdapters {
  getAvailable(userId: string): number | Promise<number>
  debitOnSuccess(userId: string, credits: number, version: string, promptId: string): Promise<{ ok: boolean }>
}

export function buildLedgerAdapters(mode: 'local' | 'hosted', live?: LiveLedgerSlice): LedgerAdapters {
  if (mode === 'hosted') {
    if (!live) throw new Error('meterWiring: hosted mode requires the live ledger')
    return {
      getAvailable: (u) => live.getAvailable(u),
      debitOnSuccess: (u, credits, version, promptId) =>
        live.debit(u, credits, `graph_run:${version}`, promptId),
    }
  }
  return {
    getAvailable: (u) => mockLedger.getAvailable(u),
    debitOnSuccess: async (u, credits, version, promptId) =>
      mockLedger.debit(u, credits, `graph_run:${version}`, promptId),
  }
}
```

(Adjust `mockLedger.debit`'s exact signature to the real one in `mockLedger.ts` — keep the reason/key layout identical between modes.)

- [ ] **Step 5: Rewire the route**

In `frontend/server/api/meter/prompt.post.ts`:

```ts
import { meterPrompt, MeterError } from '~~/server/utils/meterPrompt'
import { priceGraph } from '~~/server/utils/priceBook'
import { meterStore } from '~~/server/utils/meterStore'
import { settleOnCompletion } from '~~/server/utils/settleWatcher'
import { resolveSpikeUser, stripForeignComfyOrgCreds } from '~~/server/utils/spikeAuth'
import { deployMode } from '~~/server/utils/deployMode'
import { buildLedgerAdapters } from '~~/server/utils/meterWiring'
import { getLiveLedger } from '~~/server/utils/ledgerLive'

const COMFY = 'http://127.0.0.1:8188'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const mode = deployMode()
  // Hosted: the middleware attached the Clerk user. Local: spike header as before.
  const userId = mode === 'hosted'
    ? (event.context.userId ?? null)
    : resolveSpikeUser(getHeaders(event) as Record<string, string | undefined>)

  const adapters = buildLedgerAdapters(mode, mode === 'hosted' ? getLiveLedger() : undefined)

  const deps = {
    priceGraph,
    getAvailable: (u: string) => adapters.getAvailable(u),
    register: (promptId: string, charge: { userId: string; credits: number; version: string }) =>
      meterStore.register(promptId, charge),
    forward: async (b: any) => {
      const safeBody = { ...b, extra_data: stripForeignComfyOrgCreds(b?.extra_data, null) }
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
          void adapters.debitOnSuccess(u, credits, version, id)
            .then(r => meterStore.resolve(id, r.ok ? 'settled' : 'voided'))
            .catch((e) => {
              // Job ran but the charge failed — money bug, must be loud.
              console.error('[meter] DEBIT FAILED after successful run', { promptId: id, user: u, credits }, e)
              meterStore.resolve(id, 'voided')
            })
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

Preserve the existing spike-policy comment block on `forward` if the current file has it (it does — keep it verbatim).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/meter-wiring.unit.spec.ts`
Expected: PASS (3 tests)

Run: `npx vitest run tests/unit` — full unit suite, expected: no new failures vs. main before this task (baseline: run on the parent commit first if unsure; vitest counts can lie under load — check `uptime` if numbers look absurd).

- [ ] **Step 7: Commit**

```bash
git add server/utils/meterWiring.ts server/utils/meterPrompt.ts server/api/meter/prompt.post.ts tests/unit/meter-wiring.unit.spec.ts
git commit -m "feat(hosted): meter route debits the real ledger in hosted mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Client-side gating — hostedMode flag, sign-in pages, account page

**Files:**
- Modify: `frontend/nuxt.config.ts` (add `runtimeConfig.public.hostedMode`)
- Modify: `frontend/app/pages/sign-in/[...slug].vue`
- Modify: `frontend/app/pages/sign-up/[...slug].vue`
- Create: `frontend/app/pages/account.vue`
- Test: `frontend/tests/unit/hosted-gate.unit.spec.ts`

**Interfaces:**
- Consumes: `useRuntimeConfig().public.hostedMode: boolean`; `GET /api/wallet` (Task 5 shape); Clerk components `<SignIn />`, `<UserButton />` (auto-imported by the module in hosted mode only).
- Produces: `hostedModeEnabled(cfg: { hostedMode?: unknown }): boolean` in `frontend/app/lib/hostedMode.ts` (tiny pure helper the pages share).

- [ ] **Step 1: Add the flag to nuxt.config**

In `frontend/nuxt.config.ts`, inside the existing `runtimeConfig.public` block (find it with grep; if there is none, add `runtimeConfig: { public: { ... } }` at the top level of the config object):

```ts
runtimeConfig: {
  public: {
    // Mirrors server deployMode at build/dev start: hosted iff Clerk keys present.
    hostedMode: !!process.env.NUXT_CLERK_SECRET_KEY,
  },
},
```

(Merge with existing keys — do not clobber an existing runtimeConfig block.)

- [ ] **Step 2: Write the failing test + helper**

```ts
// frontend/tests/unit/hosted-gate.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { hostedModeEnabled } from '../../app/lib/hostedMode'

describe('hostedModeEnabled', () => {
  it('is true only for boolean true', () => {
    expect(hostedModeEnabled({ hostedMode: true })).toBe(true)
    expect(hostedModeEnabled({ hostedMode: false })).toBe(false)
    expect(hostedModeEnabled({})).toBe(false)
    expect(hostedModeEnabled({ hostedMode: 'true' })).toBe(false) // env leakage is not a yes
  })
})
```

Run: `npx vitest run tests/unit/hosted-gate.unit.spec.ts` — expected FAIL (module missing), then create:

```ts
// frontend/app/lib/hostedMode.ts
/** Hosted-mode gate for client code. Strict boolean — a string 'true' from
 * env mangling must not accidentally enable auth UI. */
export function hostedModeEnabled(cfg: { hostedMode?: unknown }): boolean {
  return cfg.hostedMode === true
}
```

Re-run — expected PASS.

- [ ] **Step 3: Gate the sign-in / sign-up pages**

Replace the full contents of `frontend/app/pages/sign-in/[...slug].vue`:

```vue
<!-- frontend/app/pages/sign-in/[...slug].vue -->
<script setup lang="ts">
// Hosted mode only: in local mode there is no login (deployMode contract),
// so this page sends you home instead of rendering a dead Clerk widget.
import { hostedModeEnabled } from '~/lib/hostedMode'
const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })
</script>

<template>
  <div v-if="hosted" class="flex min-h-screen items-center justify-center bg-background">
    <SignIn />
  </div>
</template>
```

And `frontend/app/pages/sign-up/[...slug].vue` identically with `<SignUp />`.

- [ ] **Step 4: The account page**

```vue
<!-- frontend/app/pages/account.vue -->
<script setup lang="ts">
// Minimal hosted account surface: who you are + your wallet. This is the
// Stage-1 smoke-test destination; the full account/billing UI comes with
// the launch-surfaces stage.
import { ArrowLeft } from 'lucide-vue-next'
import { hostedModeEnabled } from '~/lib/hostedMode'

const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })

const { data: wallet } = await useFetch<{ mode: string; balance?: number; available?: number }>(
  '/api/wallet', { server: false })
</script>

<template>
  <div v-if="hosted" class="min-h-screen bg-background text-white">
    <div class="mx-auto max-w-md px-6 py-10">
      <NuxtLink to="/" class="mb-8 inline-flex items-center gap-1.5 text-[12px] text-white/40 transition hover:text-white/80">
        <ArrowLeft class="size-3.5" />
        Back to Sailor
      </NuxtLink>
      <div class="flex items-center justify-between">
        <h1 class="text-[20px] font-semibold tracking-tight">Account</h1>
        <UserButton />
      </div>
      <div class="mt-6 rounded-[8px] border border-white/10 bg-white/[0.04] p-4">
        <div class="text-[11px] font-medium uppercase tracking-wide text-white/50">Credits</div>
        <div v-if="wallet?.mode === 'hosted'" class="mt-1 text-[26px] font-semibold tabular-nums">
          {{ wallet.available }}
          <span class="text-[13px] font-normal text-white/40">available · {{ wallet.balance }} total</span>
        </div>
        <div v-else class="mt-1 text-[13px] text-white/40">Wallet unavailable.</div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Verify local mode redirects**

Run: `curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/account`
Expected: `200` (SSR renders the redirect shell — what matters is no 500)

Run: `curl -s --max-time 20 http://127.0.0.1:3000/api/wallet`
Expected: `{"mode":"local"}`

- [ ] **Step 6: Full unit suite + commit**

Run: `npx vitest run tests/unit` — no new failures.

```bash
git add nuxt.config.ts app/lib/hostedMode.ts "app/pages/sign-in/[...slug].vue" "app/pages/sign-up/[...slug].vue" app/pages/account.vue tests/unit/hosted-gate.unit.spec.ts
git commit -m "feat(hosted): client hosted-mode gate — sign-in/up pages + account page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Hosted smoke run-book (manual, with Julien)

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-stage1-hosted-smoke-checklist.md`

This task writes the run-book and performs the parts that need no human; the sign-in itself is Julien's.

- [ ] **Step 1: Write the checklist doc**

```markdown
# Stage 1 hosted smoke test — run-book

**Plain summary:** boot Sailor in hosted mode on this machine, sign in as the
first real user, and watch the wallet appear with the 200-credit welcome
bonus. This is the proof that Clerk, the auth middleware, user sync, and the
Neon ledger all work end to end.

## One-time setup
1. Start a SECOND dev server in hosted mode (leave the daily one alone):
   `cd frontend && env $(grep -v '^#' .env.hosted | xargs) PORT=3100 npm run dev`
2. Confirm hosted mode armed: `curl -s http://127.0.0.1:3100/api/wallet` → expect `401` (not `{"mode":"local"}`).
3. Confirm engine paths guarded: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/prompt` → `401`.

## The smoke (Julien)
4. Open http://127.0.0.1:3100/sign-in — the Clerk widget should render (Email + Google).
5. Sign up with your email. Expect redirect + a session.
6. Visit http://127.0.0.1:3100/account — expect **200 available · 200 total** (signup bonus via lazy sync).
7. In Neon console → Tables → users: your Clerk user id row exists with your email.
8. In Clerk dashboard → Users: the same user.

## Webhook leg (optional now, required before launch)
9. In Clerk dashboard → Webhooks: add endpoint (needs a public URL — use
   `clerk webhook test` locally or defer to the deployed environment), subscribe to
   `user.created`, set `CLERK_WEBHOOK_SIGNING_SECRET` in the hosted env.
   Until then, lazy sync covers user creation.

## Teardown
10. Ctrl-C the hosted server. The daily local server was never touched.
```

- [ ] **Step 2: Verify the run-book's automated preconditions**

Run steps 1–3 of the run-book yourself (background the hosted server, curl both probes, then kill it). Record actual outputs in the checklist file (replace "expect" lines with "verified: <output>" where you ran them). If either probe fails, STOP and fix before handing to Julien.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-stage1-hosted-smoke-checklist.md
git commit -m "docs(hosted): Stage 1 hosted smoke run-book

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §5.1 coverage: middleware (T3), webhook (T4), lazy get-or-create (T2/T3), sign-in pages (T7). §5.2 untouched (landed earlier). §5.3 Stripe deliberately out of scope (blocked on pricing call).
- The meter's hold/settle path still uses debit-on-success (spike shape), not hold→settle — that refactor is Stage 4 (metering all routes) territory, deliberately not smuggled in here.
- `mockLedger` API details in Task 6 are marked "inspect and match" — implementer must read `mockLedger.ts` before writing the test.
- Env names: Clerk webhook secret is read by `verifyWebhook` from `CLERK_WEBHOOK_SIGNING_SECRET` (checked in @clerk/nuxt dist: it delegates to @clerk/backend/webhooks default env). If the actual name differs at implementation time, read `node_modules/@clerk/nuxt/dist/runtime/webhooks.js` and use what it uses.
```
