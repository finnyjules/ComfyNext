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
