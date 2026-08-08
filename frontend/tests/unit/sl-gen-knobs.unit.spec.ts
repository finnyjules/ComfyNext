import { describe, it, expect } from 'vitest'
import { resolveKnobs, type KnobSpec } from '~~/shared/template-grid/generate/knobs'
import { makeRng } from '~~/shared/template-grid/generate/rng'

const SPECS: KnobSpec[] = [
  { id: 'align', pick: ['left', 'split'] },
  { id: 'breakAggression', pick: [1, 2, 3] },
]

describe('knobs', () => {
  it('resolves every knob to a value from its domain', () => {
    const k = resolveKnobs(SPECS, makeRng(11))
    expect(['left', 'split']).toContain(k.align)
    expect([1, 2, 3]).toContain(k.breakAggression)
  })
  it('is deterministic per seed', () => {
    expect(resolveKnobs(SPECS, makeRng(5))).toEqual(resolveKnobs(SPECS, makeRng(5)))
  })
  it('honours overrides (a locked knob keeps its value)', () => {
    const k = resolveKnobs(SPECS, makeRng(1), { align: 'split' })
    expect(k.align).toBe('split')
  })
})
