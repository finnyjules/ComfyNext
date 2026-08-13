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

beforeAll(async () => {
  ({ resolveClerkUserId, resolveHostedUserId, shouldLazySync, __resetLazySyncForTests, __setClerkClientForTests } = await import('../../server/middleware/auth'))
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
