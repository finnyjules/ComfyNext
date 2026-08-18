import { describe, it, expect } from 'vitest'
import { renderStudio } from '~/lib/geoshape/render'
import { overlapFaces } from '~/lib/geoshape/boolean'
import { renderShapes } from '~/lib/geoshape/render'
import { mergeStudioDoc, newLayerId } from '~/lib/geoshape/studio'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/geoshape/config'

// A simple single square-ish mark (one 4-gon at the origin) so overlaps are
// predictable — no radial ring, no boolean fold within the layer.
const SQUARE = {
  ...DEFAULT_CONFIG, shape: 'polygon', sides: 4, count: 1, radius: 0, spacing: 0,
  size: 120, fillStrategy: 'single', symmetry: false, clipMask: 'none', stroke: null,
}
const layerOf = (mark: any, offset?: any) => ({
  layerId: newLayerId(), enabled: true, mark, opacity: 1, blend: 'normal',
  offset: { x: 0, y: 0, scale: 1, rotate: 0, ...(offset ?? {}) },
})
const OVERLAP_ON = { enabled: true, fills: ['#ff0000', '#00ff00'], order: 'depth', crossingMode: 'depth' }

describe('geoshape studio cross-layer overlap', () => {
  it('adds intersection faces where two layers cross, coloured from the overlap palette', async () => {
    const doc = mergeStudioDoc({ layers: [layerOf(SQUARE), layerOf(SQUARE, { x: 80 })], overlap: OVERLAP_ON })
    const off = await renderStudio({ ...doc, overlap: { ...doc.overlap, enabled: false } })
    const on = await renderStudio(doc)
    // Overlap ON appends faces beyond the two layer shapes.
    expect(off.length).toBe(2)
    expect(on.length).toBeGreaterThan(off.length)
    const extra = on.slice(off.length)
    expect(extra.length).toBeGreaterThanOrEqual(1)
    // Two layers => max depth 2 => every face uses fills[0] under 'depth' order.
    expect(extra.every((s) => s.fill === '#ff0000')).toBe(true)
  })

  it('produces no faces when layers do not overlap', async () => {
    const doc = mergeStudioDoc({ layers: [layerOf(SQUARE), layerOf(SQUARE, { x: 100000 })], overlap: OVERLAP_ON })
    const on = await renderStudio(doc)
    expect(on.length).toBe(2) // far apart -> no intersection faces
  })

  it('overlap disabled adds nothing even when layers cross', async () => {
    const doc = mergeStudioDoc({ layers: [layerOf(SQUARE), layerOf(SQUARE, { x: 80 })], overlap: { ...OVERLAP_ON, enabled: false } })
    expect((await renderStudio(doc)).length).toBe(2)
  })

  it('a single layer never yields overlap faces', async () => {
    const doc = mergeStudioDoc({ layers: [layerOf(SQUARE)], overlap: OVERLAP_ON })
    expect((await renderStudio(doc)).length).toBe(1)
  })

  it('overlapFaces() directly: 3-deep uses the second palette colour under depth order', async () => {
    // Three concentric squares of increasing size all cover the centre => a 3-deep
    // core (fills[1]) surrounded by a 2-deep ring (fills[0]). Marks go through
    // mergeConfig, matching how renderStudio always calls renderShapes.
    const a = await renderShapes(mergeConfig({ ...SQUARE, size: 60 }))
    const b = await renderShapes(mergeConfig({ ...SQUARE, size: 120 }))
    const c = await renderShapes(mergeConfig({ ...SQUARE, size: 180 }))
    const faces = await overlapFaces([a, b, c], { enabled: true, fills: ['#ff0000', '#00ff00'], order: 'depth', crossingMode: 'depth' } as any)
    expect(faces.length).toBeGreaterThanOrEqual(2)
    const colours = new Set(faces.map((f) => f.fill))
    expect(colours.has('#ff0000')).toBe(true) // 2-deep ring
    expect(colours.has('#00ff00')).toBe(true) // 3-deep core
    // Overlap faces carry the real paint on .paint and no stroke.
    expect(faces.every((f) => f.stroke === null)).toBe(true)
  })

  it('overlapFaces() returns [] for fewer than two non-empty layers', async () => {
    const a = await renderShapes(mergeConfig(SQUARE))
    expect(await overlapFaces([a], OVERLAP_ON as any)).toEqual([])
    expect(await overlapFaces([a, []], OVERLAP_ON as any)).toEqual([])
  })
})
