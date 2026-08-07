import { describe, it, expect } from 'vitest'
import { parseSeedreamLayers } from '~/composables/useCompositorLayers'

const JSON_IN = JSON.stringify({
  source: 'seedream', width: 1000, height: 500,
  layers: [
    { filename: 'bg.png', z_index: 0, box: null, name: '', description: '' },
    { filename: 'flower.png', z_index: 2, box: [100, 50, 300, 250], name: 'flower', description: '' },
    { filename: 'bottle.png', z_index: 1, box: [400, 100, 500, 400], name: 'bottle', description: '' },
  ],
})

describe('parseSeedreamLayers', () => {
  it('returns canvas dims + one image layer per input layer', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    expect(r.width).toBe(1000)
    expect(r.height).toBe(500)
    expect(r.imageLayers).toHaveLength(3)
    expect(r.imageLayers.every((l) => l.kind === 'image')).toBe(true)
  })

  it('places the base (boxless) layer as a full-canvas image', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    const base = r.imageLayers.find((l) => l.filename === 'bg.png')!
    expect(base.x).toBeCloseTo(0.5)
    expect(base.y).toBeCloseTo(0.5)
    expect(base.w).toBeCloseTo(1)          // full width
    expect(base.h).toBeCloseTo(500 / 1000) // H/W (width-normalized)
  })

  it('positions an element by its [l,t,r,b] box, width-normalized', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    const f = r.imageLayers.find((l) => l.filename === 'flower.png')!
    expect(f.x).toBeCloseTo(((100 + 300) / 2) / 1000)  // center X / W
    expect(f.y).toBeCloseTo(((50 + 250) / 2) / 500)    // center Y / H
    expect(f.w).toBeCloseTo((300 - 100) / 1000)        // box W / W
    expect(f.h).toBeCloseTo((250 - 50) / 1000)         // box H / W
  })

  it('returns imageLayers ordered bottom→top by z_index', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    expect(r.imageLayers.map((l) => l.filename)).toEqual(['bg.png', 'bottle.png', 'flower.png'])
  })

  it('returns null for junk', () => {
    expect(parseSeedreamLayers('not json')).toBeNull()
    expect(parseSeedreamLayers(JSON.stringify({ layers: [] }))).toBeNull()
  })
})
