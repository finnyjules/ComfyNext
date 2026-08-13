import { beforeAll, describe, expect, it } from 'vitest'

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
let shouldLazySync: (userId: string) => boolean
let __resetLazySyncForTests: () => void

beforeAll(async () => {
  ({ resolveClerkUserId, shouldLazySync, __resetLazySyncForTests } = await import('../../server/middleware/auth'))
})

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
