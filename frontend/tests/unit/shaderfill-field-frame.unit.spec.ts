import { describe, it, expect, beforeEach } from 'vitest'
import { beginFieldFrame, endFieldFrame, withFieldFrame, resolveField, clearFieldCache, fieldStats, type FieldRequest } from '~/lib/shaderfill/field'
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

// Final review, Important 2 + 3: the previous wave's coverage only ever asserted
// "does not throw" — it never asserted the diagnostic actually FIRES when a real
// HOST-ISOLATION violation happens, nor that it stays SILENT for the shape that turned
// out to be a false positive (Important 2: a Compositor hit-test replaying a stale token
// outside any span). `fieldStats().tokenMismatches` is the unconditional (non-dev-gated)
// signal both directions below assert against — see FieldStats' doc in field.ts.
describe('resolveField token mismatch — tokenMismatches counts the REAL violation and nothing else (Important 2 + 3)', () => {
  it('a stale token replayed WHILE a different span is genuinely open counts as a mismatch — the actual violation this token exists to catch', () => {
    let staleToken = 0
    withFieldFrame([req('m1')], (_fc, token) => { staleToken = token })
    const before = fieldStats().tokenMismatches
    withFieldFrame([req('n1')], () => {
      // Inside a genuinely open (different) span, resolve with the FIRST span's now-stale
      // token — exactly the interleaving `_liveKeysToken` exists to catch.
      resolveField(req('m1'), staleToken)
    })
    expect(fieldStats().tokenMismatches).toBe(before + 1)
  })

  it('a stale token replayed OUTSIDE any span (the Compositor hit-test shape) does NOT count as a mismatch — no span is open, so there is nothing to have been reassigned out from under', () => {
    let staleToken = 0
    withFieldFrame([req('m2')], (_fc, token) => { staleToken = token })
    withFieldFrame([req('n2')], () => {})   // bumps _liveKeysToken, then closes — no span open now
    const before = fieldStats().tokenMismatches
    resolveField(req('m2'), staleToken)     // outside any span — CompositorModal's layerHitAt shape
    expect(fieldStats().tokenMismatches).toBe(before)
  })

  it('token 0 (the "no span" sentinel — what a caller should reset a cleared per-host token field to) never counts as a mismatch, even inside another genuinely open span', () => {
    const before = fieldStats().tokenMismatches
    withFieldFrame([req('o1')], () => {
      resolveField(req('o1'), 0)
    })
    expect(fieldStats().tokenMismatches).toBe(before)
  })

  it('omitting the token entirely never counts as a mismatch, even inside another genuinely open span', () => {
    const before = fieldStats().tokenMismatches
    withFieldFrame([req('o2')], () => {
      resolveField(req('o2'))
    })
    expect(fieldStats().tokenMismatches).toBe(before)
  })

  it('resolving WITH the span\'s own current token, from inside that same span, never counts as a mismatch', () => {
    const before = fieldStats().tokenMismatches
    withFieldFrame([req('p')], (_fc, token) => {
      resolveField(req('p'), token)
    })
    expect(fieldStats().tokenMismatches).toBe(before)
  })
})
