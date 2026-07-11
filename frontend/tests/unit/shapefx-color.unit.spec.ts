import { describe, it, expect } from 'vitest'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { applyVertexColors, paletteFor } from '../../app/lib/shapefx/color'
import { DEFAULT_CONFIG, type ShapeConfig, type ColoringMode, type ColorDirection } from '../../app/lib/shapefx/config'

const cfg = (coloring: ColoringMode, direction: ColorDirection = 'vertical'): ShapeConfig => ({
  ...DEFAULT_CONFIG, palette: { ...DEFAULT_CONFIG.palette, coloring, direction },
})
const colorsOf = (c: ShapeConfig): number[] => {
  const g = buildGeometry(c); applyVertexColors(g, c)
  return Array.from(g.getAttribute('color').array as Float32Array)
}
const uniqueCount = (arr: number[]): number => {
  const set = new Set<string>()
  for (let i = 0; i < arr.length; i += 3) set.add(`${arr[i]!.toFixed(3)},${arr[i + 1]!.toFixed(3)},${arr[i + 2]!.toFixed(3)}`)
  return set.size
}

describe('shapefx color', () => {
  it('paletteFor returns hex swatches', () => {
    const p = paletteFor(DEFAULT_CONFIG)
    expect(p.length).toBeGreaterThanOrEqual(2)
    expect(p.every(h => /^#[0-9a-f]{6}$/i.test(h))).toBe(true)
  })

  it('applyVertexColors adds a color attribute matching the position count', () => {
    const g = buildGeometry(cfg('smooth')); applyVertexColors(g, cfg('smooth'))
    const col = g.getAttribute('color')
    expect(col).toBeTruthy()
    expect(col.count).toBe(g.getAttribute('position').count)
    expect(col.itemSize).toBe(3)
  })

  it('is deterministic for a given seed + palette (all four modes)', () => {
    for (const m of ['prismatic', 'smooth', 'faceted', 'scatter'] as const) {
      expect(colorsOf(cfg(m))).toEqual(colorsOf(cfg(m)))
    }
  })

  it('the four coloring modes each produce different colorings', () => {
    const modes = ['prismatic', 'smooth', 'faceted', 'scatter'] as const
    const out = modes.map(m => JSON.stringify(colorsOf(cfg(m))))
    expect(new Set(out).size).toBe(modes.length) // all distinct
  })

  it('prismatic gives each facet its OWN gradient; faceted keeps each facet flat', () => {
    // gem = many triangles; check whether the 3 vertices of each facet share one color.
    const facetVaries = (coloring: ColoringMode): boolean => {
      const gem: ShapeConfig = { ...DEFAULT_CONFIG, seed: '#facegrad', shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', vertices: 24 }, palette: { ...DEFAULT_CONFIG.palette, coloring } }
      const arr = colorsOf(gem)
      for (let tri = 0; tri < arr.length; tri += 9) {
        const same = arr[tri] === arr[tri + 3] && arr[tri + 3] === arr[tri + 6]   // r of v0,v1,v2
          && arr[tri + 1] === arr[tri + 4] && arr[tri + 4] === arr[tri + 7]       // g
        if (!same) return true
      }
      return false
    }
    expect(facetVaries('prismatic')).toBe(true)  // within-facet gradient
    expect(facetVaries('faceted')).toBe(false)   // flat per facet
  })

  it('smooth/faceted are position-based (seed-independent); scatter is seed-driven', () => {
    // the gradient depends only on geometry + palette params, never the seed…
    for (const m of ['smooth', 'faceted'] as const) {
      expect(colorsOf({ ...cfg(m), seed: '#aaaa1111' })).toEqual(colorsOf({ ...cfg(m), seed: '#bbbb2222' }))
    }
    // …but the confetti re-rolls with the seed.
    expect(colorsOf({ ...cfg('scatter'), seed: '#aaaa1111' })).not.toEqual(colorsOf({ ...cfg('scatter'), seed: '#bbbb2222' }))
  })

  it('smooth on a rich shape yields a genuinely gradient (many-toned) surface', () => {
    // a torus has vertices spread along Y, so a vertical smooth ramp must yield far more
    // than the handful of discrete harmony swatches.
    const torus: ShapeConfig = { ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, primitive: 'torus' }, palette: { ...DEFAULT_CONFIG.palette, coloring: 'smooth', direction: 'vertical' } }
    expect(uniqueCount(colorsOf(torus))).toBeGreaterThan(paletteFor(torus).length * 4)
  })

  it('direction changes the smooth gradient (vertical vs radial vs angular differ)', () => {
    // torus is a good probe: it has real extent on every axis
    const torus: ShapeConfig = { ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, primitive: 'torus' } }
    const withDir = (direction: ColorDirection) => colorsOf({ ...torus, palette: { ...torus.palette, coloring: 'smooth', direction } })
    expect(withDir('vertical')).not.toEqual(withDir('radial'))
    expect(withDir('radial')).not.toEqual(withDir('angular'))
  })

  it('a wheel harmony (triadic) yields distinct swatches, not modulo-duplicated hues', () => {
    const p = paletteFor({ ...DEFAULT_CONFIG, palette: { ...DEFAULT_CONFIG.palette, harmony: 'triadic' } })
    expect(new Set(p).size).toBe(p.length)
  })
})
