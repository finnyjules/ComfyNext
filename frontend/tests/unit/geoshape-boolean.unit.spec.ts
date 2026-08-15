import { describe, it, expect } from 'vitest'
import { composite } from '~/lib/geoshape/boolean'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'
import { shapesToSVG } from '~/lib/vector/svg'

// two overlapping squares as the base+placement stand-in
const SQUARE = 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z'
const twoOverlap = [
  { x: -20, y: 0, scale: 1, rotate: 0, skew: 0 },
  { x: 20, y: 0, scale: 1, rotate: 0, skew: 0 },
]

describe('geoshape boolean composite', () => {
  it('evenodd hole: overlap becomes negative space (multiple subpaths, evenodd)', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, fillMode: 'evenodd', overlapMode: 'hole', symmetry: false, clipMask: 'none' })
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    const svg = shapesToSVG(shapes)
    expect(svg).toContain('fill-rule="evenodd"')
    // an even-odd union of two overlapping squares has an interior hole → >1 subpath (M appears ≥2×)
    const ms = (shapes[0]!.commands.filter(c => c.command === 'moveTo')).length
    expect(ms).toBeGreaterThanOrEqual(2)
  })
  it('overlapMode shape: the intersection is emitted as a separate filled shape', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, overlapMode: 'shape', overlapFill: '#ff0000', symmetry: false, clipMask: 'none' })
    // base + overlap = 2 shapes; the overlap shape carries overlapFill
    expect(shapes.length).toBe(2)
    expect(shapes[1]!.fill).toBe('#ff0000')
    // the overlap region is non-empty (has commands)
    expect(shapes[1]!.commands.length).toBeGreaterThan(0)
  })
  it('clip removes geometry outside the clip shape', async () => {
    const wide = [{ x: -200, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 200, y: 0, scale: 1, rotate: 0, skew: 0 }]
    const clipped = await composite(SQUARE, wide, { ...DEFAULT_CONFIG, overlapMode: 'hole', clipMask: 'circle', clipMaskSize: 60 })
    // clipping to a small circle drops the far-apart squares' outer extent
    const unclipped = await composite(SQUARE, wide, { ...DEFAULT_CONFIG, overlapMode: 'hole', clipMask: 'none' })
    const bbox = (s: any[]) => s.flatMap(x => x.commands).flatMap((c: any) => c.args).filter((_: any, i: number) => i % 2 === 0)
    expect(Math.max(...bbox(clipped).map(Math.abs))).toBeLessThan(Math.max(...bbox(unclipped).map(Math.abs)))
  })
})
