/**
 * geoshape boolean composite — the CORE of the 2D-vector geologo generator.
 *
 * Folds the arranged clones (Task 3's `ClonePlacement[]`) of one base shape
 * (Task 1's `d`) into the final mark via paper.js booleans, then applies the
 * user's key feature — overlapping clones read as either a HOLE (even-odd
 * negative space) or a NEW filled SHAPE — followed by symmetry mirroring and
 * a clip mask.
 *
 * paper.js hygiene follows `useVectorSvg.ts`'s `pathLayerBoolean` /
 * `extrudeSolid.ts`'s pattern exactly: lazy `import('paper')` (it touches
 * browser globals at import time, so it must not load during SSR), ONE
 * cached detached `PaperScope` (not the global `paper`, so its mutable state
 * stays out of the app), `setup(Size)` with no canvas element, and
 * `project.clear()` in a `finally` so a long session does not grow an
 * unbounded item tree.
 */
import { paperToCommands } from '~/lib/vectortype/extrudeSolid'
import { rankOrder } from './order'
import type { GeoShapeConfig } from './config'
import type { ClonePlacement } from './arrange'
import type { Paint } from '~/lib/compositor/paint'
// Type-only: `render.ts` also imports `composite` from this module, so a
// value-level import back would be a cycle. `GeoVectorShape` is a type alias
// (erased at compile time), so this direction is safe.
import type { GeoVectorShape } from './render'

/** `Paint`'s solid-string arm passes straight through; a gradient/pattern/
 *  image/shader has no single representative colour, so `VectorShape.fill`
 *  (a reader that only understands solids) gets a plain fallback instead —
 *  the real paint travels on `.paint` (see `GeoVectorShape` in `render.ts`). */
const solidOf = (p: Paint): string => (typeof p === 'string' ? p : '#808080')

let _paperMod: typeof paper | null = null
let _scope: paper.PaperScope | null = null
async function paperScope(): Promise<paper.PaperScope> {
  if (!_paperMod) _paperMod = ((await import('paper')) as unknown as { default: typeof paper }).default
  if (!_scope) {
    _scope = new _paperMod.PaperScope()
    // Headless: a project needs a size; we never attach a real canvas.
    _scope.setup(new _scope.Size(1024, 1024))
  }
  _scope.activate()
  return _scope
}

const OP: Record<Exclude<GeoShapeConfig['fillMode'], 'evenodd'>, 'unite' | 'subtract' | 'intersect' | 'exclude'> = {
  unite: 'unite', subtract: 'subtract', intersect: 'intersect', exclude: 'exclude',
}

function hexClipD(r: number): string {
  let d = ''
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3
    const x = r * Math.cos(a)
    const y = r * Math.sin(a)
    d += (i === 0 ? 'M' : 'L') + ` ${x} ${y}`
  }
  return d + ' Z'
}

/**
 * Fold `placements` clones of `baseD` into the final geologo mark.
 *
 * `evenodd` is a FILL RULE, not a paper.js boolean op: paper's `unite`
 * returns a nonzero-wound union, which for two clones sharing only a partial
 * overlap collapses to a single outer contour and loses the interior hole
 * the geologo's even-odd look depends on. So the `evenodd` branch skips the
 * boolean fold entirely — it assembles the raw (untouched, still-overlapping)
 * transformed clones as subpaths of ONE `CompoundPath` and lets the SVG/canvas
 * even-odd winding rule carve the overlap into negative space itself. Every
 * other `fillMode` maps straight onto a paper.js op and folds normally.
 */
export async function composite(baseD: string, placements: ClonePlacement[], cfg: GeoShapeConfig): Promise<GeoVectorShape[]> {
  const sc = await paperScope()
  try {
    // 1. build a transformed paper path per placement
    const clones = placements.map((pl) => {
      const p = new sc.CompoundPath(baseD)
      const m = new sc.Matrix()
      m.translate(pl.x, pl.y)
      m.rotate(pl.rotate, new sc.Point(0, 0))
      if (pl.skew) m.shear(Math.tan((pl.skew * Math.PI) / 180), 0)
      m.scale(pl.scale)
      p.transform(m)
      return p
    })
    if (!clones.length) return []

    // PER-SHAPE FILL: each clone is its own filled shape cycling through cfg.fills.
    // No boolean fold and no even-odd holes (those need the unified single-path
    // fold); clones simply layer. Symmetry mirrors each clone inheriting its paint;
    // clip intersects each clone.
    if (cfg.fillStrategy === 'perClone') {
      const fills = cfg.fills.length ? cfg.fills : [cfg.fill]
      const band = Math.max(1, cfg.size)
      const ranks = rankOrder(placements.map((pl, i) => ({ cx: pl.x, cy: pl.y, i })), cfg.fillOrder, band)
      let items: { path: paper.PathItem; pi: number }[] = clones.map((c, i) => ({ path: c as paper.PathItem, pi: ranks[i]! % fills.length }))
      if (cfg.symmetry) {
        const sm = new sc.Matrix()
        if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
        sm.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
        const mirrored = items.map(({ path, pi }) => { const mc = path.clone(); mc.transform(sm); return { path: mc as paper.PathItem, pi } })
        items = items.concat(mirrored)
      }
      if (cfg.clipMask !== 'none') {
        const r = cfg.clipMaskSize
        const clip = cfg.clipMask === 'circle'
          ? new sc.Path.Circle(new sc.Point(0, 0), r)
          : cfg.clipMask === 'square'
            ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
            : new sc.CompoundPath(hexClipD(r))
        items = items.map(({ path, pi }) => ({ path: (path as any).intersect(clip) as paper.PathItem, pi }))
        clip.remove()
      }
      return items
        .filter(({ path }) => path && path.bounds && path.bounds.width > 1e-6 && path.bounds.height > 1e-6)
        .map(({ path, pi }) => ({
          commands: paperToCommands(path),
          paint: fills[pi]!,
          fill: solidOf(fills[pi]!),
          stroke: cfg.stroke,
          strokeWidth: cfg.strokeWidth || undefined,
          fillRule: 'nonzero' as const,
        }))
    }

    if (cfg.fillStrategy === 'pieces') {
      const fills = cfg.fills.length ? cfg.fills : [cfg.fill]
      const ov = cfg.overlapFills.length ? cfg.overlapFills : fills
      const nonEmpty = (p: any): boolean => !!(p && p.bounds && p.bounds.width > 1e-6 && p.bounds.height > 1e-6)

      // Symmetry: mirror the clones BEFORE splitting so the split sees the full set.
      let cl = clones as paper.PathItem[]
      if (cfg.symmetry) {
        const sm = new sc.Matrix()
        if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
        sm.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
        const mir = clones.map((c) => { const mc = c.clone(); mc.transform(sm); return mc as paper.PathItem })
        cl = (clones as paper.PathItem[]).concat(mir)
      }
      const N = cl.length

      type Piece = { path: paper.PathItem; cx: number; cy: number; depth: number }

      // 1. solo pieces: clone_i − union(others)
      const solo: Piece[] = []
      for (let i = 0; i < N; i++) {
        let others: any = null
        for (let j = 0; j < N; j++) {
          if (j === i) continue
          others = others ? others.unite(cl[j]) : (cl[j] as any).clone()
        }
        const s = others ? (cl[i] as any).subtract(others) : (cl[i] as any).clone()
        if (nonEmpty(s)) solo.push({ path: s, cx: s.bounds.center.x, cy: s.bounds.center.y, depth: 1 })
      }

      // 2. overlap depth bands (depth ≥ 2), incremental
      const bands: (paper.PathItem | null)[] = []
      for (let k = 0; k < N; k++) {
        const c = cl[k]
        let prevCovered: any = null
        for (const bd of bands) { if (bd) prevCovered = prevCovered ? prevCovered.unite(bd) : (bd as any).clone() }
        for (let d = bands.length; d >= 1; d--) {
          const band = bands[d - 1]
          if (!band) continue
          const moved = (band as any).intersect(c)
          if (nonEmpty(moved)) {
            const rest = (band as any).subtract(c)
            bands[d - 1] = nonEmpty(rest) ? rest : null
            bands[d] = bands[d] ? (bands[d] as any).unite(moved) : moved
          }
        }
        const fresh = prevCovered ? (c as any).subtract(prevCovered) : (c as any).clone()
        bands[0] = bands[0] ? (bands[0] as any).unite(fresh) : fresh
      }
      const overlaps: Piece[] = []
      for (let d = 2; d <= bands.length; d++) {
        const band = bands[d - 1]
        if (nonEmpty(band)) overlaps.push({ path: band as paper.PathItem, cx: (band as any).bounds.center.x, cy: (band as any).bounds.center.y, depth: d })
      }

      // 3. colouring
      const bandSize = solo.length
        ? [...solo].map((p) => Math.max(p.path.bounds.width, p.path.bounds.height)).sort((a, b) => a - b)[Math.floor(solo.length / 2)]!
        : Math.max(1, cfg.size)
      const soloRanks = cfg.fillOrder === 'depth'
        ? solo.map(() => 0)
        : rankOrder(solo.map((p, i) => ({ cx: p.cx, cy: p.cy, i })), cfg.fillOrder, bandSize)
      const colored: { path: paper.PathItem; paint: Paint }[] = []
      solo.forEach((p, i) => colored.push({ path: p.path, paint: fills[soloRanks[i]! % fills.length]! }))
      overlaps.forEach((p) => {
        const paint = cfg.overlapSeparate ? ov[(p.depth - 2) % ov.length]! : fills[(p.depth - 1) % fills.length]!
        colored.push({ path: p.path, paint })
      })

      // 4. clip mask
      let clipped = colored
      if (cfg.clipMask !== 'none') {
        const r = cfg.clipMaskSize
        const clip = cfg.clipMask === 'circle'
          ? new sc.Path.Circle(new sc.Point(0, 0), r)
          : cfg.clipMask === 'square'
            ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
            : new sc.CompoundPath(hexClipD(r))
        clipped = colored.map(({ path, paint }) => ({ path: (path as any).intersect(clip) as paper.PathItem, paint }))
        clip.remove()
      }

      return clipped
        .filter(({ path }) => nonEmpty(path))
        .map(({ path, paint }) => ({
          commands: paperToCommands(path),
          paint,
          fill: solidOf(paint),
          stroke: cfg.stroke,
          strokeWidth: cfg.strokeWidth || undefined,
          fillRule: 'nonzero' as const,
        }))
    }

    const isEvenOdd = cfg.fillMode === 'evenodd'

    // Symmetry for evenodd is applied at the clone level (mirror every clone and
    // add the copies) rather than uniting the composited result: uniting a
    // self-overlapping evenodd compound is undefined in paper's boolean resolver
    // (it ignores fillRule) and empties the mark. mirror(A∪B) = mirror(A)∪mirror(B),
    // so this is equivalent for evenodd and safe.
    //
    // For subtract/exclude/intersect this clone-level approach is WRONG: running
    // mirrored clones through the same fold chain is not the same as mirroring the
    // finished mark (e.g. subtract is order-dependent and non-distributive over
    // mirroring), and it can yield empty geometry. Those modes instead fold the
    // originals first, then mirror-and-union the resolved result below (step 3.5).
    if (cfg.symmetry && isEvenOdd) {
      const sm = new sc.Matrix()
      if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
      sm.translate(
        cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0,
        cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0,
      )
      const mirrored = clones.map((c) => { const mc = c.clone(); mc.transform(sm); return mc })
      clones.push(...mirrored)
    }

    // 2. overlap-as-shape: the region covered by >=2 clones = union of
    // pairwise intersections, computed off the RAW clones BEFORE the fold
    // below — `intersect` does not consume its operands, but the evenodd
    // branch of the fold reparents each clone's children (see step 3), which
    // would leave nothing here to intersect if this ran after it.
    let overlap: paper.PathItem | null = null
    if (cfg.overlapMode === 'shape' && clones.length >= 2) {
      for (let i = 0; i < clones.length; i++) {
        for (let j = i + 1; j < clones.length; j++) {
          const inter = (clones[i] as any).intersect(clones[j])
          if (inter && inter.bounds && inter.bounds.width > 1e-6 && inter.bounds.height > 1e-6) {
            overlap = overlap ? (overlap as any).unite(inter) : inter
          } else {
            inter?.remove?.()
          }
        }
      }
    }

    // 3. fold geometry: evenodd keeps every clone as its own subpath (no
    // boolean fold, so overlaps stay as overlaps for the winding rule to
    // carve); every other fillMode folds via the matching paper.js op.
    let acc: paper.PathItem
    if (isEvenOdd) {
      const cp = new sc.CompoundPath({ children: [] })
      for (const c of clones) {
        // Reparent each clone's own children (a CompoundPath's subpaths, or
        // a lone Path) onto one CompoundPath so they become subpaths of a
        // single item — required for one fill-rule to govern all of them.
        const kids = c.className === 'CompoundPath' ? [...(c.children ?? [])] : [c]
        for (const k of kids) cp.addChild(k)
      }
      cp.fillRule = 'evenodd'
      acc = cp
    } else {
      const op = OP[cfg.fillMode as Exclude<GeoShapeConfig['fillMode'], 'evenodd'>]
      acc = clones[0] as paper.PathItem
      for (let i = 1; i < clones.length; i++) {
        const next = clones[i] as paper.PathItem
        const combined = (acc as any)[op](next)
        acc = combined
      }
    }

    // 3.5. symmetry for subtract/exclude/intersect: fold the originals into the
    // mark first (step 3, above), THEN union the resolved mark with its mirror.
    // Mirroring the finished mark is the correct "symmetry" for these ops —
    // mirroring the inputs and re-running them through the same fold chain (as
    // evenodd does) is not equivalent for subtract/exclude/intersect and can
    // empty the geometry.
    if (cfg.symmetry && !isEvenOdd) {
      const mirrorItem = (item: any) => {
        const sm = new sc.Matrix()
        if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
        sm.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
        const mi = item.clone(); mi.transform(sm); return item.unite(mi)
      }
      acc = mirrorItem(acc)
      if (overlap) overlap = mirrorItem(overlap)
    }

    // 4. clip mask: intersect the accumulated geometry (and overlap, if any)
    // with a centered circle/square/hexagon.
    if (cfg.clipMask !== 'none') {
      const r = cfg.clipMaskSize
      const clip = cfg.clipMask === 'circle'
        ? new sc.Path.Circle(new sc.Point(0, 0), r)
        : cfg.clipMask === 'square'
          ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
          : new sc.CompoundPath(hexClipD(r))
      acc = (acc as any).intersect(clip)
      if (overlap) overlap = (overlap as any).intersect(clip)
      clip.remove()
    }

    // 5. paper → VectorShape[]. evenodd sets the fill-rule; shape mode adds
    // the overlap as a second shape painted with `overlapFill`.
    const fillRule: 'evenodd' | 'nonzero' = cfg.fillMode === 'evenodd' ? 'evenodd' : 'nonzero'
    const out: GeoVectorShape[] = [{
      commands: paperToCommands(acc),
      paint: cfg.fill,
      fill: solidOf(cfg.fill),
      stroke: cfg.stroke,
      strokeWidth: cfg.strokeWidth || undefined,
      fillRule,
    }]
    if (overlap) {
      out.push({
        commands: paperToCommands(overlap),
        paint: cfg.overlapFill,
        fill: solidOf(cfg.overlapFill),
        fillRule: 'nonzero',
      })
    }
    return out
  } finally {
    sc.project.clear()
  }
}
