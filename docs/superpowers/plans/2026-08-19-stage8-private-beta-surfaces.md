# Stage 8 — Private-Beta Launch Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open-signup spend hole with a default-deny email allowlist, add legal pages + sign-up consent, and surface server refusals (moderation / credits / paused) as readable canvas notices.

**Architecture:** A pure `betaAccess` util (parse + check + memoized Clerk email lookup) is enforced at BOTH signup-bonus grant paths — the auth middleware's attach branch (403 `beta_not_invited`, before any provisioning) and the Clerk `user.created` webhook (skip sync). The frontend shows a full-screen gate when the wallet fetch returns that 403. Legal pages are plain static Nuxt pages; consent uses Clerk's built-in legal-acceptance checkbox. Refusal surfacing extends the existing bridge `queue_error` channel to recognize h3-shaped refusal bodies and adds a toast on the Vue side.

**Tech Stack:** Nuxt 4 / Nitro server utils, @clerk/backend, vitest unit tests, vue-sonner toasts, sailor_bridge (plain JS, ComfyUI iframe).

**Spec:** `docs/superpowers/specs/2026-08-19-stage8-private-beta-surfaces-design.md` — read it first.

## Global Constraints

- No `NUXT_CLERK_SECRET_KEY` ⇒ local mode ⇒ byte-identical. Every new behavior gated on hosted mode or env presence. Local `:3000` regression is part of final verification.
- `SAILOR_BETA_ALLOWLIST` lives ONLY in gitignored `frontend/.env.hosted` (and Fly secrets at deploy). Beta users' emails are NEVER committed — not in code, not in tests (tests use fake emails), not in docs.
- Access control fails CLOSED: unreadable list, missing email, or failed Clerk lookup ⇒ deny.
- In hosted mode an unset/empty `SAILOR_BETA_ALLOWLIST` denies EVERYONE (default-deny).
- No commas in trailing comments on `export const` lines under `frontend/server/` (mlly export-scanner bug).
- Run every unit-test command with `env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST` so live-Neon or a developer's local allowlist can't leak into tests (the Stage-7 C2 lesson).
- All test/dev commands run from `frontend/`.
- Action buttons in new UI use the existing `StudioButton` component (action blue); never hand-roll buttons.
- The bridge (`custom_nodes/sailor_bridge/js/bridge.js`) is NOT hot-reloaded — ComfyUI must be restarted to pick up bridge changes.

---

### Task 1: betaAccess util (pure logic + memoized check)

**Files:**
- Create: `frontend/server/utils/betaAccess.ts`
- Test: `frontend/tests/unit/beta-access.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module; env is passed in, never read here).
- Produces (later tasks rely on these exact signatures):
  - `parseAllowlist(raw: string | null | undefined): Set<string>`
  - `isEmailAllowed(allow: Set<string>, email: string | null | undefined): boolean`
  - `checkBetaAccess(userId: string, deps: BetaAccessDeps): Promise<{ allowed: boolean; email: string | null }>` where `BetaAccessDeps = { allowlistRaw: string | undefined; getEmail: (userId: string) => Promise<string | null> }`
  - `__resetBetaAccessForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/beta-access.unit.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAllowlist, isEmailAllowed, checkBetaAccess, __resetBetaAccessForTests } from '../../server/utils/betaAccess'

beforeEach(() => __resetBetaAccessForTests())

describe('parseAllowlist', () => {
  it('returns an empty set for unset/empty/whitespace input (default-deny)', () => {
    expect(parseAllowlist(undefined).size).toBe(0)
    expect(parseAllowlist(null).size).toBe(0)
    expect(parseAllowlist('').size).toBe(0)
    expect(parseAllowlist('  , ,  ').size).toBe(0)
  })
  it('splits on commas, trims, and lowercases', () => {
    const s = parseAllowlist(' Ada@Example.com ,bea@studio.io,  ')
    expect(s).toEqual(new Set(['ada@example.com', 'bea@studio.io']))
  })
})

describe('isEmailAllowed', () => {
  const list = parseAllowlist('ada@example.com,bea@studio.io')
  it('matches case-insensitively with surrounding whitespace tolerated', () => {
    expect(isEmailAllowed(list, 'ADA@example.COM')).toBe(true)
    expect(isEmailAllowed(list, ' bea@studio.io ')).toBe(true)
  })
  it('denies a non-listed email, a null/empty email, and everything on an empty list', () => {
    expect(isEmailAllowed(list, 'mallory@evil.io')).toBe(false)
    expect(isEmailAllowed(list, null)).toBe(false)
    expect(isEmailAllowed(list, '')).toBe(false)
    expect(isEmailAllowed(new Set<string>(), 'ada@example.com')).toBe(false)
  })
})

describe('checkBetaAccess', () => {
  it('allows a listed email and denies a non-listed one', async () => {
    const deps = { allowlistRaw: 'ada@example.com', getEmail: vi.fn(async () => 'ada@example.com') }
    expect(await checkBetaAccess('user_a', deps)).toEqual({ allowed: true, email: 'ada@example.com' })
    const deny = { allowlistRaw: 'ada@example.com', getEmail: vi.fn(async () => 'mallory@evil.io') }
    expect((await checkBetaAccess('user_m', deny)).allowed).toBe(false)
  })
  it('memoizes a successful email lookup per user (one Clerk call, not one per request)', async () => {
    const getEmail = vi.fn(async () => 'ada@example.com')
    const deps = { allowlistRaw: 'ada@example.com', getEmail }
    await checkBetaAccess('user_a', deps)
    await checkBetaAccess('user_a', deps)
    expect(getEmail).toHaveBeenCalledTimes(1)
  })
  it('fails CLOSED and does NOT memoize when the lookup fails (retry on a later request)', async () => {
    const getEmail = vi.fn(async () => { throw new Error('clerk down') })
    const deps = { allowlistRaw: 'ada@example.com', getEmail }
    expect((await checkBetaAccess('user_a', deps)).allowed).toBe(false)
    const recovered = { allowlistRaw: 'ada@example.com', getEmail: vi.fn(async () => 'ada@example.com') }
    expect((await checkBetaAccess('user_a', recovered)).allowed).toBe(true)
  })
  it('a null email from a successful lookup denies and is not memoized', async () => {
    const deps = { allowlistRaw: 'ada@example.com', getEmail: vi.fn(async () => null) }
    expect((await checkBetaAccess('user_a', deps)).allowed).toBe(false)
    expect(deps.getEmail).toHaveBeenCalledTimes(1)
    await checkBetaAccess('user_a', deps)
    expect(deps.getEmail).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/beta-access.unit.spec.ts`
Expected: FAIL — cannot resolve `../../server/utils/betaAccess`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/server/utils/betaAccess.ts
/**
 * Private-beta access allowlist (Stage 8 spec, Component A). Pure logic —
 * this module NEVER reads env or constructs a Clerk client; callers pass
 * the raw allowlist string and an email-lookup function so it unit-tests
 * without a harness (the authGuard.ts pattern).
 *
 * Fail direction: CLOSED. An empty/unset list denies everyone; a failed or
 * empty email lookup denies. Same rationale as the spend guard — an
 * unknown access state is a money risk (each stray signup = 100 bonus
 * credits of real provider exposure).
 */

export function parseAllowlist(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(e => e.length > 0))
}

export function isEmailAllowed(allow: Set<string>, email: string | null | undefined): boolean {
  if (!email) return false
  return allow.has(email.trim().toLowerCase())
}

export interface BetaAccessDeps {
  allowlistRaw: string | undefined
  getEmail: (userId: string) => Promise<string | null>
}

// Per-process memo of SUCCESSFUL email resolutions only — a failed or null
// lookup must retry on a later request (transient Clerk blips shouldn't
// lock a beta user out for the process lifetime). The allowed/denied
// verdict is recomputed per call (a cheap Set lookup) so behavior tracks
// the env exactly; only the Clerk round-trip is memoized.
let emailMemo = new Map<string, string>()

export async function checkBetaAccess(
  userId: string,
  deps: BetaAccessDeps,
): Promise<{ allowed: boolean; email: string | null }> {
  let email = emailMemo.get(userId) ?? null
  if (email === null) {
    try {
      email = await deps.getEmail(userId)
    } catch {
      email = null
    }
    if (email) emailMemo.set(userId, email)
  }
  return { allowed: isEmailAllowed(parseAllowlist(deps.allowlistRaw), email), email }
}

export function __resetBetaAccessForTests(): void { emailMemo = new Map() }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/beta-access.unit.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/betaAccess.ts frontend/tests/unit/beta-access.unit.spec.ts
git commit -m "feat(stage8): beta allowlist util — default-deny, fail-closed, memoized email lookup"
```

---

### Task 2: enforce the allowlist in the auth middleware

**Files:**
- Modify: `frontend/server/middleware/auth.ts` (the `ClerkClientLike` type, a new `fetchPrimaryEmail` helper, and the `attach` branch of the default handler)
- Test: `frontend/tests/unit/auth-middleware-helpers.unit.spec.ts` (extend the existing file)

**Interfaces:**
- Consumes: `checkBetaAccess` from Task 1 (exact signature above); existing `guardDecision`, `bindMeterContext`, `ensureUserWithBonus`, `shouldLazySync`, `__setClerkClientForTests`.
- Produces: `fetchPrimaryEmail(userId: string): Promise<string | null>` (exported for tests); the middleware throws `403` with `data: { code: 'beta_not_invited' }` for a signed-in, non-listed user — Task 4's frontend gate keys on exactly `statusCode === 403` + `data.code === 'beta_not_invited'` in the response body.

**Context you must know (read the file first):**
- The handler's synchronous prefix (`clearMeterContext()` first) is load-bearing — do not move it or wrap the handler (see the GUARD comment in the file). Your changes go inside the existing `attach` branch, which already runs after an `await`, so adding another `await` there is safe.
- The lazy `ensureUserWithBonus` call is the bonus-grant path this task must protect: the deny throw goes BEFORE `event.context.userId = ...`, `bindMeterContext`, and the lazy-sync block.
- The existing test file stubs `defineEventHandler`/`createError` globals before dynamically importing the module — follow its exact pattern; note its `createError` stub does not carry `data`, so extend the stub to copy `opts.data` onto the error for the new assertions.

- [ ] **Step 1: Write the failing tests** (append to `auth-middleware-helpers.unit.spec.ts`)

First extend the `createError` stub at the top of the file so refusal data survives:

```ts
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string, data?: unknown }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number, data?: unknown }
  err.statusCode = opts.statusCode
  err.data = opts.data
  return err
}
```

Then add (import `fetchPrimaryEmail` from the auth module in `beforeAll`, and `__resetBetaAccessForTests` from `../../server/utils/betaAccess`):

```ts
describe('fetchPrimaryEmail', () => {
  afterEach(() => __setClerkClientForTests(null))
  it('returns the primary email address', async () => {
    __setClerkClientForTests({
      users: { getUser: async () => ({ primaryEmailAddressId: 'em_2', emailAddresses: [{ id: 'em_1', emailAddress: 'old@example.com' }, { id: 'em_2', emailAddress: 'ada@example.com' }] }) },
    } as any)
    expect(await fetchPrimaryEmail('user_a')).toBe('ada@example.com')
  })
  it('falls back to the first email when no primary id matches', async () => {
    __setClerkClientForTests({ users: { getUser: async () => ({ emailAddresses: [{ id: 'em_1', emailAddress: 'only@example.com' }] }) } } as any)
    expect(await fetchPrimaryEmail('user_a')).toBe('only@example.com')
  })
  it('returns null on a lookup failure or an email-less user (fail closed upstream)', async () => {
    __setClerkClientForTests({ users: { getUser: async () => { throw new Error('down') } } } as any)
    expect(await fetchPrimaryEmail('user_a')).toBeNull()
    __setClerkClientForTests({ users: { getUser: async () => ({ emailAddresses: [] }) } } as any)
    expect(await fetchPrimaryEmail('user_a')).toBeNull()
  })
})

describe('auth handler — beta allowlist enforcement (hosted)', () => {
  // Hosted mode via env; a stubbed Clerk client authenticates user_a whose
  // email is resolved by the same stub's users.getUser.
  const HOSTED_ENV = { NUXT_CLERK_SECRET_KEY: 'sk_test_stub' }
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = {}
    for (const k of ['NUXT_CLERK_SECRET_KEY', 'SAILOR_BETA_ALLOWLIST']) saved[k] = process.env[k]
    Object.assign(process.env, HOSTED_ENV)
    __resetBetaAccessForTests()
    __resetLazySyncForTests()
    __resetMeterContextForTests()
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    __setClerkClientForTests(null)
  })

  function stubClerk(email: string | null) {
    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => ({ userId: 'user_a' }) }),
      users: { getUser: async () => ({ emailAddresses: email ? [{ id: 'em_1', emailAddress: email }] : [] }) },
    } as any)
  }
  function guardedEvent(): any {
    return { path: '/api/wallet', context: {}, web: { request: new Request('http://localhost/api/wallet') } }
  }

  it('rejects a signed-in non-listed user with 403 beta_not_invited and never provisions them', async () => {
    process.env.SAILOR_BETA_ALLOWLIST = 'ada@example.com'
    stubClerk('mallory@evil.io')
    const event = guardedEvent()
    await expect(authHandler(event)).rejects.toMatchObject({ statusCode: 403, data: { code: 'beta_not_invited' } })
    expect(event.context.userId).toBeUndefined()          // never attached
    expect(currentMeterContext()).toBeNull()               // never metered
    expect(shouldLazySync('user_a')).toBe(true)            // lazy sync never consumed → bonus never granted
  })
  it('denies EVERYONE when the allowlist is unset (default-deny)', async () => {
    delete process.env.SAILOR_BETA_ALLOWLIST
    stubClerk('ada@example.com')
    await expect(authHandler(guardedEvent())).rejects.toMatchObject({ statusCode: 403 })
  })
  it('attaches a listed user exactly as before', async () => {
    process.env.SAILOR_BETA_ALLOWLIST = 'ada@example.com'
    stubClerk('ada@example.com')
    shouldLazySync('user_a') // pre-consume the memo so the handler skips the real-ledger lazy sync
    const event = guardedEvent()
    await authHandler(event)
    expect(event.context.userId).toBe('user_a')
    expect(currentMeterContext()).toEqual({ userId: 'user_a' })
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/auth-middleware-helpers.unit.spec.ts`
Expected: FAIL — `fetchPrimaryEmail` not exported; the non-listed user currently attaches instead of throwing 403. Pre-existing tests must still pass.

- [ ] **Step 3: Implement in `server/middleware/auth.ts`**

(a) Extend the client type so the stub and the real client line up:

```ts
type ClerkClientLike = {
  authenticateRequest: (req: Request) => Promise<{ toAuth: () => { userId: string | null } | null }>
  users?: { getUser: (userId: string) => Promise<any> }
}
```

(b) Add the email helper (near `resolveHostedUserId`):

```ts
/** Primary email for a Clerk user — the beta-allowlist identity. Returns
 * null on any failure so checkBetaAccess fails CLOSED (deny, retry later). */
export async function fetchPrimaryEmail(userId: string): Promise<string | null> {
  try {
    const u: any = await getClerkClient().users!.getUser(userId)
    const emails: Array<{ id?: string; emailAddress?: string }> = u?.emailAddresses ?? []
    const primary = emails.find(e => e.id === u?.primaryEmailAddressId) ?? emails[0]
    return primary?.emailAddress ?? null
  } catch {
    return null
  }
}
```

(c) Import `checkBetaAccess` from `../utils/betaAccess` and gate the attach branch — the deny throw goes FIRST, before any attach/provision side effect:

```ts
  if (decision.kind === 'attach') {
    // Private-beta allowlist (Stage 8): deny BEFORE attaching identity,
    // binding the meter, or lazily provisioning the wallet+bonus — a
    // non-invited signup must never acquire a spendable wallet. Fails
    // CLOSED (unset list or failed email lookup ⇒ deny).
    const beta = await checkBetaAccess(decision.userId, {
      allowlistRaw: process.env.SAILOR_BETA_ALLOWLIST,
      getEmail: fetchPrimaryEmail,
    })
    if (!beta.allowed) {
      throw createError({ statusCode: 403, message: 'Sailor is in private beta', data: { code: 'beta_not_invited' } })
    }
    event.context.userId = decision.userId
    bindMeterContext({ userId: decision.userId })
    if (shouldLazySync(decision.userId)) {
      void ensureUserWithBonus(getLiveLedger(), decision.userId)
        .catch((e) => {
          console.error('[auth] lazy user sync failed for', decision.userId, e)
          lazySynced.delete(decision.userId) // retry on a later request
        })
    }
  }
```

- [ ] **Step 4: Run the file's full suite**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/auth-middleware-helpers.unit.spec.ts`
Expected: PASS — new tests AND every pre-existing test in the file.

- [ ] **Step 5: Broken-control check** — temporarily revert the deny throw (comment out the `if (!beta.allowed)` block), re-run, and confirm the "rejects a signed-in non-listed user" test FAILS. Restore. This proves the test exercises the guard, not a mock of it.

- [ ] **Step 6: Commit**

```bash
git add frontend/server/middleware/auth.ts frontend/tests/unit/auth-middleware-helpers.unit.spec.ts
git commit -m "feat(stage8): enforce beta allowlist at the auth chokepoint — 403 before any provisioning"
```

---

### Task 3: skip webhook provisioning for non-listed emails

**Files:**
- Modify: `frontend/server/utils/clerkEvents.ts`
- Modify: `frontend/server/api/webhooks/clerk.post.ts`
- Test: `frontend/tests/unit/clerk-events.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `parseAllowlist` + `isEmailAllowed` from Task 1.
- Produces: `ClerkEventDeps` gains `emailAllowed: (email: string | null) => boolean`; `handleClerkEvent` returns `{ handled: false }` without calling `sync` when the extracted primary email is not allowed.

- [ ] **Step 1: Write the failing tests** (extend `clerk-events.unit.spec.ts`; existing tests construct `handleClerkEvent(evt, deps)` — read them first and update every existing `deps` literal to include `emailAllowed: () => true` so they keep passing)

```ts
describe('beta allowlist at the webhook', () => {
  const evtFor = (email: string) => ({
    type: 'user.created',
    data: { id: 'user_m', primary_email_address_id: 'em_1', email_addresses: [{ id: 'em_1', email_address: email }] },
  })
  it('skips sync entirely for a non-listed email (no user row, no wallet, no bonus)', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(evtFor('mallory@evil.io'), { sync, emailAllowed: e => e === 'ada@example.com' })
    expect(res).toEqual({ handled: false })
    expect(sync).not.toHaveBeenCalled()
  })
  it('still syncs a listed email', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(evtFor('ada@example.com'), { sync, emailAllowed: e => e === 'ada@example.com' })
    expect(res).toEqual({ handled: true })
    expect(sync).toHaveBeenCalledWith('user_m', 'ada@example.com')
  })
  it('a user.created with NO email is skipped (fail closed)', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(
      { type: 'user.created', data: { id: 'user_x', email_addresses: [] } },
      { sync, emailAllowed: () => true },
    )
    expect(res).toEqual({ handled: false })
    expect(sync).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/clerk-events.unit.spec.ts`
Expected: FAIL — `emailAllowed` unknown / non-listed email currently syncs.

- [ ] **Step 3: Implement**

In `clerkEvents.ts` — add the dep and the gate after primary-email extraction:

```ts
export interface ClerkEventDeps {
  sync: (userId: string, email: string | null) => Promise<void>
  /** Beta allowlist check (Stage 8) — a non-listed or missing email skips
   * provisioning entirely. Injected so this module stays env-free. */
  emailAllowed: (email: string | null) => boolean
}
```

and in `handleClerkEvent`, after `const primary = ...`:

```ts
  const email = primary?.email_address ?? null
  // Private beta (Stage 8): never provision a non-invited signup from the
  // webhook path — the middleware guards the lazy path, this guards the
  // eager one. Both must hold or the wallet+bonus leaks. Fail closed on a
  // missing email. Acknowledged (200 upstream) so Clerk does not retry.
  if (!deps.emailAllowed(email)) return { handled: false }
  await deps.sync(id, email)
  return { handled: true }
```

In `clerk.post.ts` — wire the real check:

```ts
import { parseAllowlist, isEmailAllowed } from '~~/server/utils/betaAccess'
// ... in the handler:
  const result = await handleClerkEvent(evt, {
    sync: (userId, email) => ensureUserWithBonus(getLiveLedger(), userId, email),
    emailAllowed: email => isEmailAllowed(parseAllowlist(process.env.SAILOR_BETA_ALLOWLIST), email),
  })
```

- [ ] **Step 4: Run to verify pass** — same command as Step 2. Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/clerkEvents.ts frontend/server/api/webhooks/clerk.post.ts frontend/tests/unit/clerk-events.unit.spec.ts
git commit -m "feat(stage8): beta allowlist gates the Clerk webhook provisioning path too"
```

---

### Task 4: the "private beta" gate screen (frontend)

**Files:**
- Create: `frontend/app/components/BetaGate.vue`
- Create: `frontend/app/lib/betaGate.ts`
- Modify: `frontend/app/layouts/default.vue` (the wallet-fetch `catch` around line 2863 + template root)
- Test: `frontend/tests/unit/beta-gate.unit.spec.ts`

**Interfaces:**
- Consumes: the 403 shape from Task 2 — a `$fetch` FetchError with `statusCode === 403` and body `data.data.code === 'beta_not_invited'` (h3 nests the error payload under `data` in the serialized body; `e.data` is the parsed body, so the code is at `e.data?.data?.code`). Verify this nesting against a live response in Step 5 — if the body turns out to be flat (`e.data?.code`), fix `isBetaGateError` to check BOTH, and keep both in the test.
- Produces: `isBetaGateError(e: unknown): boolean` in `app/lib/betaGate.ts`; a `betaGated` ref in the default layout that mounts `<BetaGate />` full-screen.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/beta-gate.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { isBetaGateError } from '../../app/lib/betaGate'

describe('isBetaGateError', () => {
  it('recognizes the middleware refusal in both h3 body nestings', () => {
    expect(isBetaGateError({ statusCode: 403, data: { data: { code: 'beta_not_invited' } } })).toBe(true)
    expect(isBetaGateError({ statusCode: 403, data: { code: 'beta_not_invited' } })).toBe(true)
  })
  it('ignores other errors — plain 403s, 401s, network failures, junk', () => {
    expect(isBetaGateError({ statusCode: 403, data: { data: { code: 'other' } } })).toBe(false)
    expect(isBetaGateError({ statusCode: 401 })).toBe(false)
    expect(isBetaGateError(new Error('network'))).toBe(false)
    expect(isBetaGateError(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/beta-gate.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/betaGate.ts
/** Recognizes the auth middleware's private-beta refusal (Stage 8).
 * Checks both h3 body nestings (`data.data.code` and `data.code`) because
 * the serialized error payload shape differs between h3 versions. */
export function isBetaGateError(e: unknown): boolean {
  const err = e as { statusCode?: number; data?: { code?: string; data?: { code?: string } } } | null
  if (!err || err.statusCode !== 403) return false
  const code = err.data?.data?.code ?? err.data?.code
  return code === 'beta_not_invited'
}
```

```vue
<!-- frontend/app/components/BetaGate.vue -->
<script setup lang="ts">
// Full-screen gate for a signed-in account that is not on the beta
// allowlist (Stage 8). No waitlist capture — the beta is hand-invited.
import { useUser, useClerk } from '@clerk/vue'
const { user } = useUser()
const clerk = useClerk()
</script>

<template>
  <div class="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
    <h1 class="text-xl font-semibold">Sailor is in private beta</h1>
    <p class="max-w-sm text-sm opacity-70">
      This account<template v-if="user?.primaryEmailAddress"> ({{ user.primaryEmailAddress.emailAddress }})</template>
      isn't on the invite list yet. If you're expecting access, reach out to the person who invited you.
    </p>
    <StudioButton @click="clerk?.signOut()">Sign out</StudioButton>
    <div class="mt-6 flex gap-4 text-xs opacity-50">
      <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
      <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
      <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
    </div>
  </div>
</template>
```

NOTE — before using `@clerk/vue` imports, check how the codebase actually accesses Clerk client-side: `grep -rn "useUser\|useClerk\|from '@clerk" frontend/app/ frontend/package.json`. `account.vue` uses `<UserButton />` (auto-registered by the Clerk Nuxt module) — use whatever composable/import pattern that module provides (`@clerk/nuxt` exposes `useUser`/`useClerk` as auto-imports; if so, drop the explicit import). Match the existing pattern; do not introduce a new Clerk package.

In `app/layouts/default.vue` — the wallet fetch's catch becomes gate-aware, and the layout template mounts the gate:

```ts
import { isBetaGateError } from '~/lib/betaGate'
const betaGated = ref(false)
// ... inside the existing wallet-fetch function's catch:
  } catch (e) {
    if (isBetaGateError(e)) betaGated.value = true
    hostedWallet.value = null /* signed out, gated, or transient — pill shows em dash */
  }
```

and in the template, directly inside the root element:

```html
<BetaGate v-if="betaGated" />
```

- [ ] **Step 4: Run to verify pass** — Step 2's command. Expected: PASS. Also run `npx nuxt typecheck 2>&1 | tail -5` and confirm the error count is at the ~328 baseline with no NEW errors naming betaGate/BetaGate (typecheck-baseline rule: an error naming your feature's types is yours).

- [ ] **Step 5: Live verification (hosted :3100)** — start the hosted dev server WITHOUT `SAILOR_BETA_ALLOWLIST` set (default-deny), sign in with the dev account in the Browser pane, and confirm: the gate screen renders with the account email, the canvas is not reachable behind it, and Sign out returns to the signed-out state. Then verify the response-body nesting assumption of Step 1 (curl the wallet route with the session cookie, or read the FetchError in the console) and correct `isBetaGateError` + tests if the real shape differs. Then add your own email to `.env.hosted`'s `SAILOR_BETA_ALLOWLIST`, restart, and confirm normal operation returns.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/BetaGate.vue frontend/app/lib/betaGate.ts frontend/app/layouts/default.vue frontend/tests/unit/beta-gate.unit.spec.ts
git commit -m "feat(stage8): full-screen private-beta gate for non-invited accounts"
```

---

### Task 5: legal pages (/terms, /privacy, /content-policy)

**Files:**
- Create: `frontend/app/components/LegalShell.vue`
- Create: `frontend/app/pages/terms.vue`
- Create: `frontend/app/pages/privacy.vue`
- Create: `frontend/app/pages/content-policy.vue`
- Modify: `frontend/app/pages/sign-up/[...slug].vue` and `frontend/app/pages/sign-in/[...slug].vue` (footer links under the Clerk card)

**Interfaces:**
- Consumes: nothing from other tasks. Public static pages in BOTH modes (harmless locally).
- Produces: routes `/terms`, `/privacy`, `/content-policy` that Task 4's gate screen and Task 7's moderation toast link to.

**Content rules (from the spec — verified against the code, do not embellish):**
- Every page carries a visible "Beta draft — this document will be reviewed by counsel before public launch" note.
- Credits: prepaid, non-refundable except where required by law, prices repriceable. Credits DO NOT currently expire (verified: `ledger.credit` is called without `expiresAt` for both purchases and the signup bonus) — the Terms *reserve the right* to add expiry with notice; do NOT claim credits expire today.
- Content policy mirrors the live moderation categories (OpenAI omni-moderation): sexual content involving minors (absolute, zero tolerance), non-consensual sexual content, hate/harassment, credible threats/incitement of violence, self-harm promotion, illicit-activity facilitation. State that prompts are automatically screened and violating prompts are blocked before generation.
- Privacy names the real processors: Clerk (accounts), Stripe (payments — Sailor never sees card numbers), Neon (database: account email, credit ledger, generation records), Sentry (error reports — prompt text is scrubbed), and the generation providers (Replicate, fal.ai, Anthropic, OpenAI moderation — prompt text is sent to providers to run generations and to OpenAI for safety screening; image data is not sent to the moderation service).
- Plain language throughout. No invented company entity — the operating party is "Sailor (operated by Julien, sole proprietor)" pending real legal setup.

- [ ] **Step 1: Implement the shell**

```vue
<!-- frontend/app/components/LegalShell.vue -->
<script setup lang="ts">
defineProps<{ title: string; updated: string }>()
</script>

<template>
  <div class="min-h-screen bg-background">
    <div class="mx-auto max-w-2xl px-6 py-16">
      <NuxtLink to="/" class="text-xs opacity-50 hover:underline">← Sailor</NuxtLink>
      <h1 class="mt-4 text-2xl font-semibold">{{ title }}</h1>
      <p class="mt-1 text-xs opacity-50">Last updated {{ updated }}</p>
      <p class="mt-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
        Beta draft — this document will be reviewed by counsel before public launch.
      </p>
      <div class="legal-prose mt-8 space-y-4 text-sm leading-relaxed opacity-90">
        <slot />
      </div>
      <div class="mt-12 flex gap-4 text-xs opacity-50">
        <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
        <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
        <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legal-prose :deep(h2) { font-size: 1rem; font-weight: 600; margin-top: 1.5rem; }
.legal-prose :deep(ul) { list-style: disc; padding-left: 1.25rem; }
</style>
```

- [ ] **Step 2: Write the three pages.** Each is `<LegalShell title="…" updated="August 19, 2026">` around prose sections. Full required content per page (write these as real prose in `<h2>`/`<p>`/`<ul>` — the bullet lists below are the section-by-section content contract, not placeholders):

**`/terms` — Terms of Service:** (1) *Who we are & acceptance* — Sailor, operated by Julien (sole proprietor); creating an account means agreeing to these terms + the Privacy and Content policies. (2) *Beta service* — Sailor is a private beta: features change, breakage happens, no uptime or fitness warranty, access can be suspended or ended at any time. (3) *Credits* — generation runs on prepaid credits; new accounts receive a starting grant; purchased credits are charged via Stripe; credit costs per generation can change at any time (prices shown before each run); credits are not redeemable for cash and are non-refundable except where the law requires; credits do not currently expire, but we reserve the right to introduce expiry for future grants with at least 30 days' notice. (4) *Your content* — you own the outputs you generate, to the extent we hold any rights in them we assign them to you; you are responsible for your prompts and uploads and must have rights to what you upload; you grant us the limited license needed to process, store, and display your content back to you. (5) *Acceptable use* — as per the Content Policy; automated prompt screening may block violating prompts; abuse can end access. (6) *Liability* — the service is provided "as is"; to the maximum extent permitted by law our total liability is capped at the amount you paid in the past 3 months. (7) *Changes & contact* — we can update these terms with notice for material changes; contact hello@madebyjulien.com.

**`/privacy` — Privacy Policy:** (1) *What we collect* — account email and sign-in identity (via Clerk); your prompts, uploads, saved projects, and generated outputs; a credit ledger of your generation activity; error reports with prompt text removed. (2) *Processors* — the named-processors list from the content rules above, one line each with what they receive. (3) *What we don't do* — no selling of personal data, no ad tracking, no analytics beyond operating the service. (4) *Retention & deletion* — content kept while the account is active; email hello@madebyjulien.com to delete your account and data. (5) *Beta caveat* — during the beta, operator access to stored content may be used for debugging with care taken to touch only what's needed.

**`/content-policy` — Content Policy:** intro (prompts are automatically screened before generation; violating prompts are blocked and nothing is charged) + the prohibited list from the content rules above + enforcement (blocked prompts are logged; repeated deliberate attempts can end beta access) + appeal (a false positive? email hello@madebyjulien.com — beta moderation is imperfect and fail-open by design).

- [ ] **Step 3: Add footer links** under the `<SignUp />` / `<SignIn />` cards (inside the existing `v-if="hosted"` wrapper, below the Clerk component):

```html
<div class="absolute bottom-6 flex gap-4 text-xs opacity-50">
  <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
  <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
  <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
</div>
```

(Adjust the wrapper to `relative flex-col` as needed so the footer sits under the card.)

- [ ] **Step 4: Verify** — with the LOCAL dev server (:3000): all three routes render, the beta-draft banner shows, internal links work, and `/` still loads normally. Confirm no purple (colour conventions — the banner is amber, which is reserved for taste/notice chrome and acceptable here as a warning note; links inherit default styling).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/LegalShell.vue frontend/app/pages/terms.vue frontend/app/pages/privacy.vue frontend/app/pages/content-policy.vue "frontend/app/pages/sign-up/[...slug].vue" "frontend/app/pages/sign-in/[...slug].vue"
git commit -m "feat(stage8): terms, privacy, and content-policy pages (beta drafts) + auth-card footer links"
```

---

### Task 6: consent checkbox at sign-up (Clerk legal acceptance)

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-stage8-deploy-notes.md` (operator config record)

**Interfaces:**
- Consumes: the `/terms` and `/privacy` routes from Task 5.
- Produces: the Clerk dev instance requires a "I agree to the Terms of Service and Privacy Policy" checkbox at sign-up and stamps `legal_accepted_at` on each new user; a documented, repeatable config step for the prod instance at deploy.

**This is operator configuration, not app code.** Clerk's legal-acceptance feature lives in instance settings (Dashboard: Configure → Legal; API: `PATCH /v1/instance` with `legal_terms_url` / `legal_privacy_policy_url` fields under the instance settings payload). Use the **clerk-cli skill** (available in this repo's environment) — it handles auth and API calls.

- [ ] **Step 1:** Using the clerk-cli skill, inspect the current instance settings and find the legal-acceptance fields (`clerk api` against the instance settings endpoint; the skill documents discovery).
- [ ] **Step 2:** Set terms URL to `http://127.0.0.1:3100/terms` and privacy URL to `http://127.0.0.1:3100/privacy` on the DEV instance and enable the require-consent toggle. (At Fly deploy these are re-set to the production domain — record that in the deploy notes.)
- [ ] **Step 3:** Verify in the Browser pane on `:3100`: the sign-up card now shows the consent checkbox linking both documents, and sign-up is blocked until it is checked. Confirm via clerk-cli that a test signup carries `legal_accepted_at`.
- [ ] **Step 4:** If the plan/API does NOT expose legal acceptance (feature-gated on a paid Clerk tier): STOP, do not build the Sailor-side interstitial speculatively — record the finding in the deploy notes and report it in your task summary; the operator decides (spec names the interstitial as the design reserve).
- [ ] **Step 5:** Write `docs/superpowers/specs/2026-08-19-stage8-deploy-notes.md` — a short operator record: the exact clerk-cli/API calls made, the prod-instance re-run steps at deploy time (real domain URLs), and the `SAILOR_BETA_ALLOWLIST` Fly-secret step (set it BEFORE first boot — default-deny means an unset list locks everyone out, which is safe but confusing). Commit:

```bash
git add docs/superpowers/specs/2026-08-19-stage8-deploy-notes.md
git commit -m "docs(stage8): clerk legal-acceptance config + allowlist deploy notes"
```

---

### Task 7: surface metering refusals on the canvas

**Files:**
- Modify: `custom_nodes/sailor_bridge/js/bridge.js` (the `queuePrompt` action handler, ~lines 1146–1165)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (the `queue_error` branch of `handleBridgeMessage`, ~line 2637)
- Create: `frontend/app/lib/queueRefusal.ts`
- Test: `frontend/tests/unit/queue-refusal.unit.spec.ts`

**Interfaces:**
- Consumes: the proxy's refusal bodies. `MeterRefusalError` serializes h3-shaped: `{ statusCode, message, data? }` — e.g. `{ statusCode: 400, message: "This prompt was blocked by content moderation", data: { categories: [...] } }`, `{ statusCode: 402, message: "insufficient credits", data: { required, available } }`, 403 file-ownership messages, `{ statusCode: 503, message: "Sailor is temporarily paused..." }`. ComfyUI validation errors keep their existing shape `{ error: {...}, node_errors: {...} }`.
- Produces: the bridge posts `queue_error` with an added `refusal: true` + `statusCode` when the body is h3-shaped; `describeQueueRefusal(data)` in `app/lib/queueRefusal.ts` returns toast copy; the Vue handler shows a `toast.error` for refusals (today they render as the generic "workflow failed validation" with zero node marks — i.e. silently).

**Bridge context you must know:** `ensurePromptErrorCapture()` stashes the parsed non-200 body on `window._sailorLastPromptError`; the handler currently extracts `resp?.error?.message` (ComfyUI shape) and falls back to "The workflow failed validation." An h3 refusal body has NO `.error` and NO `.node_errors` — it has top-level `message` + `statusCode`. The bridge is NOT hot-reloaded: restart ComfyUI after editing (`cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188` — but in this repo use `./dev.sh` conventions; for unit-test purposes no server is needed).

- [ ] **Step 1: Write the failing test for the Vue-side helper**

```ts
// frontend/tests/unit/queue-refusal.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { describeQueueRefusal } from '../../app/lib/queueRefusal'

describe('describeQueueRefusal', () => {
  it('moderation refusal → title + content-policy pointer', () => {
    const d = describeQueueRefusal({ refusal: true, statusCode: 400, message: 'This prompt was blocked by content moderation' })
    expect(d).toEqual({ title: 'This prompt was blocked by content moderation', description: 'See our content policy for what’s allowed.', policyLink: true })
  })
  it('credits refusal → plain message, no policy link', () => {
    const d = describeQueueRefusal({ refusal: true, statusCode: 402, message: 'insufficient credits' })
    expect(d).toEqual({ title: 'insufficient credits', description: undefined, policyLink: false })
  })
  it('paused / ownership refusals pass their server message through', () => {
    expect(describeQueueRefusal({ refusal: true, statusCode: 503, message: 'Sailor is temporarily paused' })!.title).toBe('Sailor is temporarily paused')
    expect(describeQueueRefusal({ refusal: true, statusCode: 403, message: 'graph references an input file you do not own (LoadImage.image)' })!.title).toContain('do not own')
  })
  it('non-refusal queue errors (ComfyUI validation) → null (existing node-mark path handles them)', () => {
    expect(describeQueueRefusal({ message: 'The workflow failed validation.', node_errors: { '5': {} } })).toBeNull()
    expect(describeQueueRefusal({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/queue-refusal.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// frontend/app/lib/queueRefusal.ts
/** Toast copy for a bridge `queue_error` that is a Nuxt-proxy metering
 * refusal (moderation / credits / ownership / paused) rather than a
 * ComfyUI validation error. Returns null for the latter — those are
 * handled by the existing per-node red-ring path. */
export interface QueueRefusalNotice {
  title: string
  description: string | undefined
  policyLink: boolean
}

export function describeQueueRefusal(data: { refusal?: boolean; statusCode?: number | null; message?: string }): QueueRefusalNotice | null {
  if (!data?.refusal || typeof data.message !== 'string' || !data.message) return null
  const moderation = data.statusCode === 400
  return {
    title: data.message,
    description: moderation ? 'See our content policy for what’s allowed.' : undefined,
    policyLink: moderation,
  }
}
```

- [ ] **Step 4: Run to verify pass** — Step 2's command. Expected: PASS.

- [ ] **Step 5: Bridge change** — in the `queuePrompt` handler, replace the message-extraction block:

```js
            if (resp || hasNodeErrors) {
              const nodeErrors = toCloneable(resp?.node_errors) || (hasNodeErrors ? toCloneable(lastErrs) : null);
              // An h3-shaped body (top-level message + statusCode, no
              // error/node_errors) is a Nuxt-proxy METERING REFUSAL —
              // moderation, insufficient credits, file ownership, paused.
              // Tag it so the parent shows a toast instead of hunting for
              // node ids that don't exist. (Stage 8.)
              const isRefusal = !!(resp && !resp.error && !resp.node_errors && typeof resp.message === "string" && resp.message);
              const message =
                (resp?.error && (resp.error.message || String(resp.error))) ||
                (isRefusal && resp.message) ||
                "The workflow failed validation.";
              console.error("[Sailor Bridge] prompt refused/failed:", message, nodeErrors);
              postToParent({
                event: "queue_error",
                message,
                node_errors: nodeErrors,
                refusal: isRefusal,
                statusCode: (resp && typeof resp.statusCode === "number") ? resp.statusCode : null,
              });
            } else if (!window._sailorLastPromptOk) {
```

(the `else if`/`else` branches are unchanged — shown for anchoring only).

- [ ] **Step 6: Vue handler** — extend the `queue_error` branch in `handleBridgeMessage` (keep the existing per-node marking; add the toast before the `return`):

```ts
  if (evt === 'queue_error') {
    // Nuxt-proxy metering refusal (moderation / credits / ownership /
    // paused): no node ids exist, so without this toast the refusal is
    // completely silent. (Stage 8.)
    const refusal = describeQueueRefusal(event.data)
    if (refusal) {
      toast.error(refusal.title, {
        description: refusal.description,
        ...(refusal.policyLink ? { action: { label: 'Content policy', onClick: () => window.open('/content-policy', '_blank') } } : {}),
      })
      return
    }
    const { perNode } = summarizeNodeErrors(event.data.node_errors)
    // ... existing code unchanged
  }
```

Import `describeQueueRefusal` from `~/lib/queueRefusal` at the top of the file (alongside the existing `vue-sonner` import).

- [ ] **Step 7: Live verification (hosted :3100, allowlisted account).** Restart ComfyUI (bridge change). The cheapest real refusal to trigger WITHOUT spending: hand the graph a file you don't own — or, simpler and deterministic, temporarily set `SAILOR_DAILY_CREDIT_CEILING=0`? NO — 0/unset disables the ceiling (Stage 7); use `POST /api/admin/controls {"globalPaused": true}` as the admin (needs `ADMIN_CLERK_USER_ID` in `.env.hosted`), submit any run, and confirm the toast shows "Sailor is temporarily paused…". Unpause afterwards (`{"globalPaused": false}`). If admin env isn't set up, fall back to a moderation trigger with `OPENAI_API_KEY` set and an obviously violating prompt — nothing is charged either way (refusals precede the hold). Screenshot the toast for the verification record.

- [ ] **Step 8: Commit**

```bash
git add custom_nodes/sailor_bridge/js/bridge.js frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/lib/queueRefusal.ts frontend/tests/unit/queue-refusal.unit.spec.ts
git commit -m "feat(stage8): surface metering refusals (moderation/credits/paused/ownership) as canvas toasts"
```

---

### Task 8: final verification + stage record

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-stage8-private-beta-surfaces-verification.md`
- Modify: `docs/STATE.md` (Stage 8 row)

**Steps:**

- [ ] **Step 1: Clean-env unit sweep, twice** (vitest-counts-lie rule: check `uptime`/load first, run twice, compare collected totals):
`cd frontend && env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST npx vitest run tests/unit/beta-access.unit.spec.ts tests/unit/auth-middleware-helpers.unit.spec.ts tests/unit/clerk-events.unit.spec.ts tests/unit/beta-gate.unit.spec.ts tests/unit/queue-refusal.unit.spec.ts`
Expected: identical green counts both runs.

- [ ] **Step 2: Local `:3000` byte-identical regression:** wallet returns `{"mode":"local"}`; `/terms`, `/privacy`, `/content-policy` render (the one deliberate local-visible addition — public static pages per spec); NO gate screen ever; NO Clerk email lookups in the server log; canvas submits work exactly as before (local chokepoint never refuses).

- [ ] **Step 3: Hosted `:3100` probes:** unauthenticated `/api/wallet` → 401 (unchanged); signed-in non-listed → 403 `beta_not_invited` + gate screen + Neon has NO user row / NO signup-bonus ledger row for that user (query via the psql helper used in Stage-6 verification); listed → normal; consent checkbox at sign-up (from Task 6); refusal toast (from Task 7 Step 7).

- [ ] **Step 4: Write the verification doc** — follow the Stage-7 file's structure exactly (`2026-08-17-stage7-guardrails-verification.md`): plain summary, what the stage built, VERIFIED automated, Julien's checklist (signed-in: second non-listed account sees the gate; add-then-remove an email from the list flips access on restart; consent checkbox; a blocked prompt shows the toast), deferred/riders, teardown. Update `docs/STATE.md`'s stage table.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-19-stage8-private-beta-surfaces-verification.md docs/STATE.md
git commit -m "docs(stage8): verification record + state update"
```

- [ ] **Step 6 (session lead, not a subagent):** update the ⛵ build dashboard artifact with the Stage 8 row (read the LIVE artifact first, merge, republish — standing rule).

