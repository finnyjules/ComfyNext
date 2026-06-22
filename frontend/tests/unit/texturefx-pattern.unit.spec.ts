import { describe, expect, it } from 'vitest'
import { patternColor } from '~/lib/texturefx/pattern'
import { textureDefaults } from '~/lib/texturefx/controls'
import { MOTIFS, LATTICES, TILE_FAMILIES } from '~/lib/texturefx/types'

const eq = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

describe('patternColor seamlessness', () => {
  for (const lattice of LATTICES) {
    for (const motif of MOTIFS) {
      it(`${lattice}/${motif} wraps left↔right and top↔bottom`, () => {
        const p = { ...textureDefaults(), lattice, motif, cells: 8, jitter: 0.6 }
        for (let i = 0; i <= 10; i++) {
          const t = i / 10
          expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
          expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
        }
      })
    }
  }

  it('returns rgba in 0..1', () => {
    const p = textureDefaults()
    const c = patternColor(p, 0.3, 0.7)
    expect(c).toHaveLength(4)
    for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('checker alternates between adjacent cells', () => {
    const p = { ...textureDefaults(), motif: 'checker', lattice: 'square', cells: 8 }
    const a = patternColor(p, 0.5 / 8, 0.5 / 8)
    const b = patternColor(p, 1.5 / 8, 0.5 / 8)
    expect(eq(a, b)).toBe(false)
  })

  // --- Truchet mode ---
  for (const lattice of LATTICES) {
    for (const family of TILE_FAMILIES) {
      it(`truchet ${lattice}/${family} wraps both axes`, () => {
        const p = { ...textureDefaults(), mode: 'truchet', lattice, tileFamily: family, cells: 8, rotBias: 0.6 }
        for (let i = 0; i <= 10; i++) {
          const t = i / 10
          expect(eq(patternColor(p, 0, t), patternColor(p, 1, t)), `x-wrap @ v=${t}`).toBe(true)
          expect(eq(patternColor(p, t, 0), patternColor(p, t, 1)), `y-wrap @ u=${t}`).toBe(true)
        }
      })
    }
  }

  it('truchet diagonal family splits a cell into two colors', () => {
    const p = { ...textureDefaults(), mode: 'truchet', tileFamily: 'diagonal', lattice: 'square', cells: 8, rotBias: 1 }
    const lower = patternColor(p, 0.9 / 8, 0.1 / 8)
    const upper = patternColor(p, 0.1 / 8, 0.9 / 8)
    expect(eq(lower, upper)).toBe(false)
  })
})
