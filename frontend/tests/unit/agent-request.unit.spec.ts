import { describe, expect, it } from 'vitest'
import {
  MAX_PHRASE_CHARS,
  optionalApiKey,
  optionalString,
  optionalTier,
  requireString,
  resolveAnthropicKey,
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
  it('treats empty and whitespace-only strings as absent', () => {
    expect(optionalString('', 'guidance', 100)).toBeUndefined()
    expect(optionalString('   ', 'guidance', 100)).toBeUndefined()
  })
  it('rejects non-strings and over-cap strings', () => {
    expect(() => optionalString(42, 'guidance', 100)).toThrow()
    expect(() => optionalString('x'.repeat(101), 'guidance', 100)).toThrow()
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

describe('resolveAnthropicKey', () => {
  it('prefers the client key (BYOK override) over the server key', () => {
    expect(resolveAnthropicKey('sk-server', 'sk-client')).toBe('sk-client')
  })
  it('falls back to the server key when the client sends none', () => {
    expect(resolveAnthropicKey('sk-server', undefined)).toBe('sk-server')
    expect(resolveAnthropicKey('sk-server', '')).toBe('sk-server')
  })
  it('throws 503 with remedy copy when neither key exists', () => {
    try {
      resolveAnthropicKey(undefined, undefined)
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.statusCode).toBe(503)
      expect(e.message).toContain('NUXT_ANTHROPIC_API_KEY')
    }
  })
  it('treats whitespace-only keys as absent', () => {
    expect(() => resolveAnthropicKey('   ', '  ')).toThrow()
  })
})

describe('optionalApiKey', () => {
  it('passes through a real key and normalizes empty to undefined', () => {
    expect(optionalApiKey('sk-abc')).toBe('sk-abc')
    expect(optionalApiKey('')).toBeUndefined()
    expect(optionalApiKey(undefined)).toBeUndefined()
    expect(optionalApiKey(null)).toBeUndefined()
  })
  it('still rejects oversized keys', () => {
    expect(() => optionalApiKey('x'.repeat(501))).toThrow()
  })
})
