import { describe, it, expect, beforeEach } from 'vitest'
import { beginFieldFrame, endFieldFrame, withFieldFrame, resolveField, clearFieldCache, type FieldRequest } from '~/lib/shaderfill/field'
import { DEFAULT_SHADER_SPEC } from '~/lib/spacetype/fillTile'

// Final review, Item 1 (Regression — fix first): `beginFieldFrame` used to THROW on
// re-entry. That crashed on two entirely legal arrangements: (a) sequential,
// non-overlapping begin/…/begin calls with no `endFieldFrame()` in between (exactly
// what pages/dev/shaderfill-bench.vue's several helper functions did — reproduced
// below), and (b) any exception between a `beginFieldFrame` and its matching
// `endFieldFrame`, which left `_frameOpen` stuck true PROCESS-WIDE with no try/finally
// anywhere, so the NEXT host's next `beginFieldFrame` call threw too. Fixed by making
// the span structural (`withFieldFrame`, a try/finally) and replacing the throw with a
// token comparison `resolveField` can check without crashing the render path. These
// tests exercise every effectId with an id no catalog will ever resolve, so `resolve()`
// short-circuits before touching WebGL/canvas — safe in this DOM-less unit environment.

function req(effectId: string): FieldRequest {
  return { spec: { ...DEFAULT_SHADER_SPEC, effectId, params: {} }, w: 64, h: 64, t: 0, fps: 30 }
}

beforeEach(() => {
  clearFieldCache()
})

describe('withFieldFrame — structural begin/end pairing (Item 1)', () => {
  it('closes the span even when fn throws, so the exception cannot leave it stuck open', () => {
    expect(() => withFieldFrame([req('a')], () => { throw new Error('boom') })).toThrow('boom')
    // The regression this proves: before the fix, the span above would have stayed
    // "open" forever (no try/finally at any real call site) and this next span would
    // have thrown on re-entry. Now it must not throw.
    expect(() => withFieldFrame([req('b')], () => {})).not.toThrow()
  })

  it('passes frozenCount and a token through to fn, and resolveField accepts that token', () => {
    const result = withFieldFrame([req('c')], (frozenCount, token) => {
      expect(typeof frozenCount).toBe('number')
      expect(typeof token).toBe('number')
      // Must not throw when given the token for the span it's actually running inside.
      expect(() => resolveField(req('c'), token)).not.toThrow()
      return 'ok'
    })
    expect(result).toBe('ok')
  })

  it('returns whatever fn returns', () => {
    expect(withFieldFrame([req('d')], () => 42)).toBe(42)
  })
})

describe('beginFieldFrame/endFieldFrame — legacy pairing no longer throws on re-entry (the exact bench bug)', () => {
  it('two SEQUENTIAL beginFieldFrame calls with no endFieldFrame in between do not throw', () => {
    // This is precisely pages/dev/shaderfill-bench.vue's pre-fix shape: loop(), runSweep(),
    // runProbe(), and runBatch() each called beginFieldFrame and never called
    // endFieldFrame — strictly one after another, never actually overlapping in time.
    expect(() => {
      beginFieldFrame([req('e')])
      beginFieldFrame([req('f')])
      beginFieldFrame([req('g')])
    }).not.toThrow()
  })

  it('a normal begin -> resolve -> end cycle still works exactly as before', () => {
    const { frozenCount, token } = beginFieldFrame([req('h')])
    expect(frozenCount).toBeGreaterThanOrEqual(0)
    expect(() => resolveField(req('h'), token)).not.toThrow()
    expect(() => endFieldFrame()).not.toThrow()
  })
})

describe('resolveField token mismatch — detected, never thrown (Item 1)', () => {
  it('a stale token (captured before a later span reassigned liveKeys) does not throw', () => {
    let staleToken = 0
    withFieldFrame([req('i')], (_fc, token) => { staleToken = token })
    // A second, later span opens and closes — bumps the module's current token.
    withFieldFrame([req('j')], () => {})
    // Resolving with the FIRST span's now-stale token must fall back gracefully, not throw.
    expect(() => resolveField(req('i'), staleToken)).not.toThrow()
  })

  it('omitting the token entirely (pre-migration/ad-hoc call shape) still works', () => {
    expect(() => resolveField(req('k'))).not.toThrow()
  })
})
