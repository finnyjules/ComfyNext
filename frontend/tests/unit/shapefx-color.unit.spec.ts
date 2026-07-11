import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { applyVertexColors, paletteFor } from '../../app/lib/shapefx/color'
import { DEFAULT_CONFIG, type ShapeConfig, type ColorRule } from '../../app/lib/shapefx/config'

const cfg = (rule: ColorRule): ShapeConfig => ({
  ...DEFAULT_CONFIG, palette: { ...DEFAULT_CONFIG.palette, rule },
})

describe('shapefx color', () => {
  it('paletteFor returns hex swatches', () => {
    const p = paletteFor(DEFAULT_CONFIG)
    expect(p.length).toBeGreaterThanOrEqual(2)
    expect(p.every(h => /^#[0-9a-f]{6}$/i.test(h))).toBe(true)
  })

  it('applyVertexColors adds a color attribute matching the position count', () => {
    const g = buildGeometry(cfg('facet'))
    applyVertexColors(g, cfg('facet'))
    const col = g.getAttribute('color')
    expect(col).toBeTruthy()
    expect(col.count).toBe(g.getAttribute('position').count)
    expect(col.itemSize).toBe(3)
  })

  it('is deterministic for a given seed + palette', () => {
    const a = buildGeometry(cfg('facet')); applyVertexColors(a, cfg('facet'))
    const b = buildGeometry(cfg('facet')); applyVertexColors(b, cfg('facet'))
    expect(Array.from(a.getAttribute('color').array)).toEqual(Array.from(b.getAttribute('color').array))
  })

  it('facet vs depth rules produce different colorings', () => {
    const a = buildGeometry(cfg('facet')); applyVertexColors(a, cfg('facet'))
    const b = buildGeometry(cfg('depth')); applyVertexColors(b, cfg('depth'))
    expect(Array.from(a.getAttribute('color').array)).not.toEqual(Array.from(b.getAttribute('color').array))
  })

  it('depth vs height rules produce different colorings (guards the cz/cy axis swap)', () => {
    const d = buildGeometry(cfg('depth')); applyVertexColors(d, cfg('depth'))
    const h = buildGeometry(cfg('height')); applyVertexColors(h, cfg('height'))
    expect(Array.from(d.getAttribute('color').array)).not.toEqual(Array.from(h.getAttribute('color').array))
  })

  it('a wheel harmony (triadic) yields distinct swatches, not modulo-duplicated hues', () => {
    const p = paletteFor({ ...DEFAULT_CONFIG, palette: { ...DEFAULT_CONFIG.palette, harmony: 'triadic' } })
    expect(new Set(p).size).toBe(p.length)
  })
})
