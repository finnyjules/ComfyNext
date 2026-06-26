import { describe, it, expect } from 'vitest'
import { VESSELL_FILLS, defaultFillsFor, vessellColorsFor } from '~/lib/spacetype/palette'
import { SPACE_TYPE_EFFECTS, getEffect } from '~/lib/spacetype/effects'

describe('vessell palette', () => {
  it('has 6 canonical slots, each a well-formed Fill', () => {
    expect(VESSELL_FILLS).toHaveLength(6)
    for (const f of VESSELL_FILLS) {
      expect(typeof f.type).toBe('string')
      expect(f.a).toMatch(/^#/); expect(f.b).toMatch(/^#/); expect(f.textColor).toMatch(/^#/)
    }
  })
  it('defaultFillsFor is deterministic for a given (count, seed)', () => {
    expect(defaultFillsFor(4, 'ball')).toBe(defaultFillsFor(4, 'ball'))
  })
  it('returns exactly count fills', () => {
    expect(JSON.parse(defaultFillsFor(3, 'coil'))).toHaveLength(3)
    expect(JSON.parse(defaultFillsFor(1, 'field'))).toHaveLength(1)
  })
  it('cycles when count exceeds the palette length', () => {
    expect(JSON.parse(defaultFillsFor(8, 'x'))).toHaveLength(8)
  })
  it('different seeds generally produce different orderings', () => {
    const a = defaultFillsFor(6, 'ball'), b = defaultFillsFor(6, 'coil'), c = defaultFillsFor(6, 'blend')
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })
  it('vessellColorsFor returns count primary colors matching the shuffled fills', () => {
    const cols = vessellColorsFor(6, 'boost')
    const fills = JSON.parse(defaultFillsFor(6, 'boost'))
    expect(cols).toHaveLength(6)
    expect(cols).toEqual(fills.map((f: any) => f.a))
  })
})

describe('effect fill defaults all come from the palette', () => {
  for (const e of SPACE_TYPE_EFFECTS) {
    const fillControl = e.controls.find(c => c.kind === 'fillList')
    if (!fillControl) continue
    it(`${e.id} fillList default is a seeded palette prefix`, () => {
      const n = JSON.parse((fillControl as any).default).length
      expect((fillControl as any).default).toBe(defaultFillsFor(n, e.id))
    })
  }
})

describe('Extrude side palette', () => {
  it('boostColor1..6 come from the Vessell palette (seeded for boost)', () => {
    const boost = getEffect('boost')
    const cols = vessellColorsFor(6, 'boost')
    for (let i = 0; i < 6; i++) {
      const ctrl = boost.controls.find(c => c.key === `boostColor${i + 1}`) as any
      expect(ctrl, `boostColor${i + 1}`).toBeTruthy()
      expect(ctrl.default).toBe(cols[i])
    }
  })
})
