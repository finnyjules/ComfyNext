import { describe, expect, it } from 'vitest'
import {
  MAX_PHRASE_CHARS,
  optionalString,
  optionalTier,
  requireApiKey,
  requireString,
} from '../../server/lib/agentRequest'

describe('requireString', () => {
  it('accepts a normal string', () => {
    expect(requireString('hello', 'prompt', 100)).toBe('hello')
  })
  it('rejects missing / non-string values with a 400 error', () => {
    for (const v of [undefined, null, 42, {}, []]) {
      expect(() => requireString(v, 'prompt', 100)).toThrowError(/prompt/)
      try { requireString(v, 'prompt', 100) } catch (e: any) { expect(e.statusCode).toBe(400) }
    }
  })
  it('rejects empty and whitespace-only strings', () => {
    expect(() => requireString('', 'prompt', 100)).toThrow()
    expect(() => requireString('   ', 'prompt', 100)).toThrow()
  })
  it('rejects strings over the cap', () => {
    expect(() => requireString('x'.repeat(101), 'prompt', 100)).toThrowError(/too long/)
  })
})

describe('optionalString', () => {
  it('passes through undefined/null as undefined', () => {
    expect(optionalString(undefined, 'guidance', 100)).toBeUndefined()
    expect(optionalString(null, 'guidance', 100)).toBeUndefined()
  })
  it('rejects non-strings and over-cap strings', () => {
    expect(() => optionalString(42, 'guidance', 100)).toThrow()
    expect(() => optionalString('x'.repeat(101), 'guidance', 100)).toThrow()
  })
})

describe('requireApiKey', () => {
  it('accepts a plausible Anthropic key', () => {
    expect(requireApiKey('sk-ant-api03-abc123')).toBe('sk-ant-api03-abc123')
  })
  it('rejects missing, non-string, and absurdly long keys', () => {
    expect(() => requireApiKey(undefined)).toThrow()
    expect(() => requireApiKey(42)).toThrow()
    expect(() => requireApiKey('k'.repeat(501))).toThrow()
  })
})

describe('optionalTier', () => {
  it('passes through known tiers', () => {
    expect(optionalTier('patch')).toBe('patch')
    expect(optionalTier('plan')).toBe('plan')
    expect(optionalTier('campaign')).toBe('campaign')
  })
  it('is undefined when absent', () => {
    expect(optionalTier(undefined)).toBeUndefined()
  })
  it('rejects unknown tier strings instead of silently defaulting', () => {
    expect(() => optionalTier('opus')).toThrowError(/tier/)
  })
})

describe('caps', () => {
  it('exports sane caps', () => {
    expect(MAX_PHRASE_CHARS).toBeGreaterThanOrEqual(2_000)
  })
})
