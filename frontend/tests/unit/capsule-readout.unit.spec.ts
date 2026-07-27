import { describe, it, expect } from 'vitest'
import { resolveReadout, formatReadoutValue, READOUT_SEPARATOR } from '~/lib/canvas/capsuleReadout'

// Mirrors the real shape from useVueNodes.ts:441-443 — widgetDefs and
// widgetsValues are POSITIONAL and index-aligned, and getWidgetDefs injects a
// hidden "<name>_control" placeholder after seed widgets to keep them aligned.
const KSAMPLER_DEFS = [
  { name: 'seed', type: 'INT' },
  { name: 'seed_control', type: 'SEED_CONTROL', hidden: true },
  { name: 'steps', type: 'INT' },
  { name: 'cfg', type: 'FLOAT' },
  { name: 'sampler_name', type: 'COMBO' },
]
const KSAMPLER_VALUES = [84021, 'randomize', 28, 3.5, 'euler']

describe('formatReadoutValue', () => {
  it('passes strings through trimmed', () => {
    expect(formatReadoutValue('  euler ')).toBe('euler')
  })

  it('renders integers without decimals', () => {
    expect(formatReadoutValue(28)).toBe('28')
  })

  it('trims trailing zeros from floats', () => {
    expect(formatReadoutValue(3.5)).toBe('3.5')
    expect(formatReadoutValue(0.7200001)).toBe('0.72')
    expect(formatReadoutValue(2.0)).toBe('2')
  })

  it('renders booleans as on/off', () => {
    expect(formatReadoutValue(true)).toBe('on')
    expect(formatReadoutValue(false)).toBe('off')
  })

  it('rejects empties rather than rendering blanks', () => {
    expect(formatReadoutValue(null)).toBeNull()
    expect(formatReadoutValue(undefined)).toBeNull()
    expect(formatReadoutValue('')).toBeNull()
    expect(formatReadoutValue('   ')).toBeNull()
    expect(formatReadoutValue({})).toBeNull()
  })
})

describe('resolveReadout — state precedence', () => {
  const base = {
    rule: { from: 'widgets' as const, parts: [{ name: 'steps', suffix: ' steps' }] },
    widgetDefs: KSAMPLER_DEFS,
    widgetsValues: KSAMPLER_VALUES,
  }

  it('puts the error message above everything', () => {
    expect(resolveReadout({
      ...base,
      running: true,
      runningSince: 1_000,
      now: 13_000,
      errorMessage: 'No credits remaining',
    })).toBe('No credits remaining')
  })

  it('collapses whitespace and truncates a long error', () => {
    const long = 'Traceback:\n  something failed in a very long and unhelpful backend message here'
    const out = resolveReadout({ ...base, errorMessage: long })!
    expect(out).not.toContain('\n')
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('reports live elapsed while running', () => {
    // fmtSec (Task 1, imported verbatim) rounds to whole seconds once the
    // elapsed value reaches 10s, so 12.5s in -> "13s" out.
    expect(resolveReadout({ ...base, running: true, runningSince: 1_000, now: 13_500 }))
      .toBe(`rendering${READOUT_SEPARATOR}13s`)
  })

  it('says rendering with no clock when the stamp is missing', () => {
    expect(resolveReadout({ ...base, running: true, runningSince: null, now: 13_500 }))
      .toBe('rendering')
  })

  it('falls back to the declared rule when idle', () => {
    expect(resolveReadout(base)).toBe('28 steps')
  })
})

describe('resolveReadout — widgets rule', () => {
  it('resolves by name across the hidden seed placeholder', () => {
    // cfg is at index 3; a naive positional read that ignored seed_control
    // would return 28 here. This is the regression this test exists for.
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'cfg', prefix: 'guidance ' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe('guidance 3.5')
  })

  it('joins parts with the separator', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [
        { name: 'steps', suffix: ' steps' },
        { name: 'cfg', prefix: 'guidance ' },
      ] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe(`28 steps${READOUT_SEPARATOR}guidance 3.5`)
  })

  it('caps at two parts even when more are declared', () => {
    const out = resolveReadout({
      rule: { from: 'widgets', parts: [
        { name: 'steps' }, { name: 'cfg' }, { name: 'sampler_name' },
      ] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })!
    expect(out.split(READOUT_SEPARATOR)).toHaveLength(2)
  })

  it('skips missing widgets instead of rendering a gap', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'nope' }, { name: 'steps', suffix: ' steps' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBe('28 steps')
  })

  it('returns null when nothing resolved', () => {
    expect(resolveReadout({
      rule: { from: 'widgets', parts: [{ name: 'nope' }] },
      widgetDefs: KSAMPLER_DEFS,
      widgetsValues: KSAMPLER_VALUES,
    })).toBeNull()
  })

  it('survives absent arrays', () => {
    expect(resolveReadout({ rule: { from: 'widgets', parts: [{ name: 'steps' }] } })).toBeNull()
  })
})

describe('resolveReadout — text rule', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(resolveReadout({
      rule: { from: 'text', property: 'prompt', max: 24 },
      properties: { prompt: 'a lighthouse at dusk, long exposure, sea fog' },
    })).toBe('a lighthouse at dusk, l…')
  })

  it('leaves short text alone', () => {
    expect(resolveReadout({
      rule: { from: 'text', property: 'prompt', max: 40 },
      properties: { prompt: 'a lighthouse at dusk' },
    })).toBe('a lighthouse at dusk')
  })

  it('returns null for a missing or blank property', () => {
    expect(resolveReadout({ rule: { from: 'text', property: 'prompt', max: 40 }, properties: {} })).toBeNull()
    expect(resolveReadout({ rule: { from: 'text', property: 'p', max: 40 }, properties: { p: '   ' } })).toBeNull()
  })
})

describe('resolveReadout — degrade to silence', () => {
  it('returns null with no rule at all', () => {
    expect(resolveReadout({})).toBeNull()
  })

  it('returns null for an explicit none rule', () => {
    expect(resolveReadout({ rule: { from: 'none' } })).toBeNull()
  })

  it('never throws on an unknown rule shape', () => {
    expect(resolveReadout({ rule: { from: 'wat' } as any })).toBeNull()
  })
})
