import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * auth.ts calls defineEventHandler at module scope (a Nitro auto-import that
 * doesn't exist under plain vitest) and its handler references createError —
 * stub the globals before a dynamic import, the taste-read-palette.unit.spec.ts
 * / loras-local-handlers.unit.spec.ts pattern.
 */
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}

let resolveClerkUserId: (event: any) => string | null
let resolveHostedUserId: (event: any) => Promise<string | null>
let shouldLazySync: (userId: string) => boolean
let __resetLazySyncForTests: () => void
let __setClerkClientForTests: (client: any) => void
let authHandler: (event: any) => Promise<void>

let bindMeterContext: (ctx: { userId: string }) => void
let currentMeterContext: () => { userId: string } | null
let __resetMeterContextForTests: () => void

beforeAll(async () => {
  const authModule = await import('../../server/middleware/auth')
  ;({ resolveClerkUserId, resolveHostedUserId, shouldLazySync, __resetLazySyncForTests, __setClerkClientForTests } = authModule)
  authHandler = authModule.default as unknown as (event: any) => Promise<void>
  ;({ bindMeterContext, currentMeterContext, __resetMeterContextForTests } = await import('../../server/utils/requestMeter'))
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
    if (savedKey === undefined) delete process.env[KEY]
    else process.env[KEY] = savedKey
  })

  it('binds currentMeterContext().userId on an authed hosted (attach) request', async () => {
    setHosted()
    __setClerkClientForTests({
      authenticateRequest: async () => ({ toAuth: () => ({ userId: 'user_1' }) }),
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
