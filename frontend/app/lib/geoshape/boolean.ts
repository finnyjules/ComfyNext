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
import type { VectorShape } from '~/lib/vector/svg'
import { paperToCommands } from '~/lib/vectortype/extrudeSolid'
import type { GeoShapeConfig } from './config'
import type { ClonePlacement } from './arrange'

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
export async function composite(baseD: string, placements: ClonePlacement[], cfg: GeoShapeConfig): Promise<VectorShape[]> {
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
    if (cfg.fillMode === 'evenodd') {
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

    // 4. symmetry mirror: reflect the accumulated geometry across the chosen
    // axis (offset by symmetrySpacing) and unite the reflection back in.
    const mirror = (item: paper.PathItem): paper.PathItem => {
      const m = new sc.Matrix()
      if (cfg.symmetryAxis === 'vertical') m.scale(-1, 1)
      else m.scale(1, -1)
      m.translate(
        cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0,
        cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0,
      )
      const mi = item.clone()
      mi.transform(m)
      const u = (item as any).unite(mi)
      mi.remove()
      return u
    }
    if (cfg.symmetry) {
      acc = mirror(acc)
      if (overlap) overlap = mirror(overlap)
    }

    // 5. clip mask: intersect the accumulated geometry (and overlap, if any)
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

    // 6. paper → VectorShape[]. evenodd sets the fill-rule; shape mode adds
    // the overlap as a second shape painted with `overlapFill`.
    const fillRule: 'evenodd' | 'nonzero' = cfg.fillMode === 'evenodd' ? 'evenodd' : 'nonzero'
    const out: VectorShape[] = [{
      commands: paperToCommands(acc),
      fill: cfg.fill,
      stroke: cfg.stroke,
      strokeWidth: cfg.strokeWidth || undefined,
      fillRule,
    }]
    if (overlap) {
      out.push({
        commands: paperToCommands(overlap),
        fill: cfg.overlapFill,
        fillRule: 'nonzero',
      })
    }
    return out
  } finally {
    sc.project.clear()
  }
}
