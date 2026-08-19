import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * auth.ts calls defineEventHandler at module scope (a Nitro auto-import that
 * doesn't exist under plain vitest) and its handler references createError —
 * stub the globals before a dynamic import, the taste-read-palette.unit.spec.ts
 * / loras-local-handlers.unit.spec.ts pattern.
 */
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string, data?: unknown }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number, data?: unknown }
  err.statusCode = opts.statusCode
  err.data = opts.data
  return err
}

let resolveClerkUserId: (event: any) => string | null
let resolveHostedUserId: (event: any) => Promise<string | null>
let fetchPrimaryEmail: (userId: string) => Promise<string | null>
let shouldLazySync: (userId: string) => boolean
let __resetLazySyncForTests: () => void
let __setClerkClientForTests: (client: any) => void
let authHandler: (event: any) => Promise<void>

let bindMeterContext: (ctx: { userId: string }) => void
let currentMeterContext: () => { userId: string } | null
let __resetMeterContextForTests: () => void
let __resetBetaAccessForTests: () => void

beforeAll(async () => {
  const authModule = await import('../../server/middleware/auth')
  ;({ resolveClerkUserId, resolveHostedUserId, fetchPrimaryEmail, shouldLazySync, __resetLazySyncForTests, __setClerkClientForTests } = authModule)
  authHandler = authModule.default as unknown as (event: any) => Promise<void>
  ;({ bindMeterContext, currentMeterContext, __resetMeterContextForTests } = await import('../../server/utils/requestMeter'))
  ;({ __resetBetaAccessForTests } = await import('../../server/utils/betaAccess'))
})

// A minimal event whose toWebRequest(event) short-circuits to event.web.request
// (h3's toWebRequest returns event.web?.request when present), so tests never
// need to construct a full node request.
function fakeEvent(): any {
  return { web: { request: new Request('http://localhost/api/wallet') } }
}

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

describe('resolveHostedUserId', () => {
  afterEach(() => {
    __setClerkClientForTests(null)
  })

  it('returns the userId when authenticateRequest resolves a signed-in state', async () => {
    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => ({ userId: 'user_1' }) }),
    })
    expect(await resolveHostedUserId(fakeEvent())).toBe('user_1')
  })

  it('returns null when toAuth() is null or has no userId', async () => {
    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => null }),
    })
    expect(await resolveHostedUserId(fakeEvent())).toBeNull()

    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => ({ userId: null }) }),
    })
    expect(await resolveHostedUserId(fakeEvent())).toBeNull()
  })

  it('returns null when authenticateRequest throws', async () => {
    __setClerkClientForTests({
      authenticateRequest: async () => { throw new Error('network error') },
    })
    expect(await resolveHostedUserId(fakeEvent())).toBeNull()
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

/**
 * Task 3 (Stage 4 metering) + review-escalation amendment: the auth
 * middleware must clear-then-bind the request-meter context on EVERY
 * hosted request — clear first (before the public-path short-circuit), so
 * a stale context from a previous request on the same async chain can
 * never bill the wrong user (enterWith is not call-scoped — see
 * requestMeter.ts), then bind a fresh context only in the attach branch.
 */
describe('auth middleware binds/clears the meter context', () => {
  const KEY = 'NUXT_CLERK_SECRET_KEY'
  const savedKey = process.env[KEY]
  const ALLOWLIST_KEY = 'SAILOR_BETA_ALLOWLIST'
  const savedAllowlist = process.env[ALLOWLIST_KEY]

  function setHosted(): void {
    process.env[KEY] = 'sk_test_hosted'
  }
  function setLocal(): void {
    delete process.env[KEY]
  }

  // Minimal fake event: `path` drives guardDecision, `context` is what the
  // attach branch mutates, `web.request` is what h3's getRequestURL /
  // getRequestHeaders read (the resolveHostedUserId test pattern above).
  function hostedEvent(path: string): any {
    return { path, context: {}, web: { request: new Request(`http://localhost${path}`) } }
  }

  afterEach(() => {
    __setClerkClientForTests(null)
    __resetLazySyncForTests()
    __resetMeterContextForTests()
    __resetBetaAccessForTests()
    if (savedKey === undefined) delete process.env[KEY]
    else process.env[KEY] = savedKey
    if (savedAllowlist === undefined) delete process.env[ALLOWLIST_KEY]
    else process.env[ALLOWLIST_KEY] = savedAllowlist
  })

  it('binds currentMeterContext().userId on an authed hosted (attach) request', async () => {
    setHosted()
    // Stage 8: the attach branch now gates on the beta allowlist, so this
    // stub must resolve an allowlisted email — this test is about
    // meter-context binding, not allowlist enforcement (see the dedicated
    // "beta allowlist enforcement" describe below for that).
    process.env[ALLOWLIST_KEY] = 'user1@example.com'
    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => ({ userId: 'user_1' }) }),
      users: { getUser: async () => ({ emailAddresses: [{ id: 'em_1', emailAddress: 'user1@example.com' }] }) },
    })
    // Pre-consume the once-per-process lazy-sync seam so the handler's
    // attach branch doesn't fire a live ensureUserWithBonus/ledger call.
    shouldLazySync('user_1')

    const event = hostedEvent('/queue')
    await authHandler(event)

    expect(currentMeterContext()?.userId).toBe('user_1')
    expect(event.context.userId).toBe('user_1')
  })

  it('clears a stale bound context on a hosted PUBLIC-path request', async () => {
    setHosted()
    bindMeterContext({ userId: 'stale_user' })
    expect(currentMeterContext()?.userId).toBe('stale_user')

    // A public path (webhooks) short-circuits via guardDecision's 'pass'
    // before any session resolution — clearMeterContext must still have
    // run first, or the previous request's identity would leak through.
    const event = hostedEvent('/api/webhooks/clerk')
    await authHandler(event)

    expect(currentMeterContext()).toBeNull()
  })

  it('leaves the meter context null on a local-mode request', async () => {
    setLocal()
    __resetMeterContextForTests()

    const event = hostedEvent('/queue')
    await authHandler(event)

    expect(currentMeterContext()).toBeNull()
  })
})

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
