import { describe, it, expect } from 'vitest'
import { composite } from '~/lib/geoshape/boolean'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'
import { commandsToPathData, shapesToSVG } from '~/lib/vector/svg'

// two overlapping squares as the base+placement stand-in
const SQUARE = 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z'
const twoOverlap = [
  { x: -20, y: 0, scale: 1, rotate: 0, skew: 0 },
  { x: 20, y: 0, scale: 1, rotate: 0, skew: 0 },
]

// A local, detached PaperScope for test-side proofs (composite()'s own scope is
// module-private). Headless setup mirrors boolean.ts's own pattern.
let _paperMod: typeof paper | null = null
async function paperScope(): Promise<paper.PaperScope> {
  if (!_paperMod) _paperMod = ((await import('paper')) as unknown as { default: typeof paper }).default
  const scope = new _paperMod.PaperScope()
  scope.setup(new scope.Size(1024, 1024))
  scope.activate()
  return scope
}

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
  it('evenodd hole: the overlap centre is a real HOLE, not just extra subpaths', async () => {
    // placements offset the SQUARE (x∈[-50,50]) by ±20, so the left clone covers
    // x∈[-70,30] and the right clone covers x∈[-30,70]. Their shared overlap band
    // is x∈[-30,30], centred on the origin.
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, fillMode: 'evenodd', overlapMode: 'hole', symmetry: false, clipMask: 'none' })
    const sc = await paperScope()
    try {
      const p = new sc.CompoundPath(commandsToPathData(shapes[0]!.commands))
      // paper.js's real style property is `fillRule` (Style.itemDefaults.fillRule);
      // `_contains` reads it via `getFillRule()`. Confirmed by reading paper's
      // source directly — the `windingRule` name useVectorSvg.ts:457 reads back
      // does not exist anywhere in paper.js; only `fillRule` does.
      p.fillRule = 'evenodd'
      // shared overlap centre: not contained -> it's a hole
      expect(p.contains(new sc.Point(0, 0))).toBe(false)
      // deep inside the left square only (x=-60, well outside the [-30,30] overlap
      // band and inside the left square's [-70,30] extent): must be solid fill
      expect(p.contains(new sc.Point(-60, 0))).toBe(true)
    } finally {
      sc.project.clear()
    }
  })
  it('overlapMode shape: the intersection is emitted as a separate filled shape', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, overlapMode: 'shape', overlapFill: '#ff0000', symmetry: false, clipMask: 'none' })
    // base + overlap = 2 shapes; the overlap shape carries overlapFill on
    // `.paint` (the authored Paint) — `.fill` is the solid-string fallback,
    // which for a solid overlapFill happens to be the same string.
    expect(shapes.length).toBe(2)
    expect(shapes[1]!.paint).toBe('#ff0000')
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
  it('symmetry works in the default evenodd/hole mode (regression)', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, symmetry: true, clipMask: 'none' })
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    // non-empty geometry survived the mirror (the bug produced 0 commands: uniting
    // the self-overlapping evenodd compound emptied the mark)
    expect(shapes[0]!.commands.length).toBeGreaterThan(0)
    // mirroring at the clone level doubles the subpath count (2 clones -> 4
    // subpaths, since evenodd keeps every clone as its own subpath)
    const ms = shapes[0]!.commands.filter(c => c.command === 'moveTo').length
    expect(ms).toBe(4)
    const svg = shapesToSVG(shapes)
    // the SVG actually carries real path data, not an empty mark
    expect(svg).toMatch(/<path d="M-?\d/)
  })
  it('symmetry with subtract + an asymmetric placement folds first, then mirrors (regression: previously emptied)', async () => {
    // Clone-level mirror-append (correct for evenodd) is WRONG for subtract: running
    // mirrored clones through the same subtract fold as the originals is not the
    // same as mirroring the finished mark, and can empty the geometry entirely.
    const asymmetric = [
      { x: -20, y: 0, scale: 1, rotate: 0, skew: 0 },
      { x: 90, y: 30, scale: 1, rotate: 0, skew: 0 },
    ]
    const shapes = await composite(SQUARE, asymmetric, { ...DEFAULT_CONFIG, fillMode: 'subtract', symmetry: true, clipMask: 'none' })
    expect(shapes[0]!.commands.length).toBeGreaterThan(0)
    // shapesToSVG's default viewBox is "0 0 0 0" unless the caller supplies one
    // (it does not derive one from content) — so build a real viewBox from the
    // resolved mark's own bounds to confirm the geometry is truly non-degenerate,
    // not just non-empty-array.
    const sc = await paperScope()
    try {
      const p = new sc.CompoundPath(commandsToPathData(shapes[0]!.commands))
      const b = p.bounds
      expect(b.width).toBeGreaterThan(0)
      expect(b.height).toBeGreaterThan(0)
      const svg = shapesToSVG(shapes, { viewBox: [b.x, b.y, b.width, b.height] })
      expect(svg).not.toContain('viewBox="0 0 0 0"')
    } finally {
      sc.project.clear()
    }
  })
  it('fillStrategy perClone: one shape per clone, cycling fills', async () => {
    const placements = [
      { x: -60, y: 0, scale: 1, rotate: 0, skew: 0 },
      { x: 0, y: 0, scale: 1, rotate: 0, skew: 0 },
      { x: 60, y: 0, scale: 1, rotate: 0, skew: 0 },
    ]
    const shapes = await composite(SQUARE, placements, { ...DEFAULT_CONFIG, fillStrategy: 'perClone', fills: ['#ff0000', '#00ff00'], symmetry: false, clipMask: 'none' })
    expect(shapes).toHaveLength(3)
    expect(shapes.map(s => s.paint)).toEqual(['#ff0000', '#00ff00', '#ff0000']) // cycle
    for (const s of shapes) expect(s.fillRule).toBe('nonzero')
  })
  it('fillStrategy perClone symmetry mirrors clones AND inherits their paint', async () => {
    // Asymmetric on purpose: 2 clones + a 3-entry palette. Correct behaviour
    // (each mirror inherits its SOURCE clone's cycled paint) yields
    // [f0,f1, f0,f1]. The spec's #1-risk bug — computing the cycle index on the
    // concatenated (post-mirror) list, i.e. continuing the modulo past the
    // mirror boundary — would instead yield [f0,f1, f2,f0]. Those diverge only
    // when fills.length > clone count, so this case actually guards the risk
    // (a 2-clone/2-fill case produces the same sequence under both and proves
    // nothing).
    const placements = [{ x: -40, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 40, y: 0, scale: 1, rotate: 0, skew: 0 }]
    const shapes = await composite(SQUARE, placements, { ...DEFAULT_CONFIG, fillStrategy: 'perClone', fills: ['#f00', '#0f0', '#00f'], symmetry: true, clipMask: 'none' })
    expect(shapes).toHaveLength(4) // 2 originals + 2 mirrors
    expect(shapes.map(s => s.paint)).toEqual(['#f00', '#0f0', '#f00', '#0f0']) // mirror inherits source paint, NOT ['#f00','#0f0','#00f','#f00']
  })
  it('unified mode (fillStrategy single) is unchanged — evenodd hole still there', async () => {
    const shapes = await composite(SQUARE, [{ x: -20, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 20, y: 0, scale: 1, rotate: 0, skew: 0 }], { ...DEFAULT_CONFIG, fillStrategy: 'single' })
    expect(shapes[0]!.fillRule).toBe('evenodd')
  })
})
