/**
 * `Paint` → the vector spine's paint vocabulary.
 *
 * The export-side twin of `resolve.ts`: that module turns a `Paint` into
 * something a canvas can fill with, this one turns the same `Paint` into
 * something `lib/vector/svg` can write into `<defs>`. Both live here rather
 * than in either the spine or a studio, because the spine must stay free of the
 * product's fill model (Shape Studio is its second consumer) and the mapping is
 * the same for every studio that stores a `Paint`.
 *
 * TIER 1 ONLY. Gradients — `Gradient`'s multi-stop linear/radial form AND
 * `Fill`'s two-colour `a`/`b` + `angle` form, which are the same idea written
 * twice — map exactly onto SVG paint servers, so they come out as real,
 * editable vector. Everything else returns `null` and the caller degrades:
 *
 *  - `ombre`, `noise`, `shader`  → cannot be vector at all (raster embed, task 6)
 *  - `grid`, `stripes`, `checkerboard`, `qr` → `<pattern>` geometry (task 5)
 *
 * A `null` here is therefore "not YET, or not EVER" — never "no paint". The
 * caller keeps its flat-colour fallback for those.
 *
 * Pure: no DOM, no canvas. Callable from a test, a worker, or SSR.
 */
import {
  type Affine,
  type VectorGradient,
  type VectorGradientStop,
  type VectorPaint,
  type VectorRect,
  invertAffine,
} from '~/lib/vector/svg'
import { type Paint, isFill, isGradient, sortedClampedStops } from '~/lib/compositor/paint'
import { type Fill } from '~/lib/spacetype/fillTile'

export interface VectorPaintOptions {
  /**
   * `objectBoundingBox` — the paint is anchored to each referencing shape's own
   * bounds, i.e. Vector Type's `glyph` anchor. `userSpaceOnUse` — anchored to
   * `box`, i.e. the `word` and `frame` anchors.
   */
  units: 'objectBoundingBox' | 'userSpaceOnUse'
  /** The box the paint spans, in document units. Required by `userSpaceOnUse`. */
  box?: VectorRect
  /**
   * The referencing shape's own transform. Under `userSpaceOnUse` the emitted
   * `gradientTransform` is its INVERSE, which is what pins the paint in
   * document space while the shape moves over it — see `VectorGradient.units`
   * for why the untransformed-wrapper trick does not do this job.
   */
  elementTransform?: Affine | null
  /**
   * The referencing shape's box aspect (`w / h`), passed straight through to
   * `VectorGradient.aspect` — which is where the reason lives. Short version:
   * SVG's bounding-box mapping is non-uniform, so on a non-square shape both a
   * linear's band direction and a radial's radius come out wrong without it.
   * Default 1 (square).
   */
  aspect?: number
}

function stopsOf(stops: Array<{ offset: number; color: string }>): VectorGradientStop[] {
  // Sorted and clamped through the SAME helper the canvas gradients use, so the
  // two cannot disagree about what an out-of-order or out-of-range stop means.
  return sortedClampedStops(stops).map(s => ({ offset: s.offset, color: s.color }))
}

/** A `Fill`'s gradient arm is the two-colour shorthand for the same thing: `a`
 *  at 0, `b` at 1, ramped at `angle`. Written out as real stops so the export
 *  is a paint server a designer can add a third stop to. */
function fillGradientStops(fill: Fill): VectorGradientStop[] {
  return [{ offset: 0, color: fill.a }, { offset: 1, color: fill.b }]
}

function gradientFor(
  type: 'linear' | 'radial',
  angle: number,
  stops: VectorGradientStop[],
  opts: VectorPaintOptions,
): VectorGradient | null {
  if (!stops.length) return null
  const userSpace = opts.units === 'userSpaceOnUse'
  const transform = userSpace && opts.elementTransform ? invertAffine(opts.elementTransform) : null
  return {
    type,
    stops,
    ...(type === 'linear' ? { angle } : {}),
    units: opts.units,
    ...(userSpace ? {} : { aspect: opts.aspect ?? 1 }),
    ...(userSpace && opts.box ? { box: opts.box } : {}),
    ...(transform ? { transform } : {}),
  }
}

/**
 * A `Paint` as something the SVG writer can paint with, or `null` where this
 * paint has no vector form (see the header).
 *
 * A flat colour comes back as the string itself, so a caller can use one code
 * path for `solid` and for a gradient.
 */
export function paintToVectorPaint(paint: Paint | undefined, opts: VectorPaintOptions): VectorPaint | null {
  if (typeof paint === 'string') return paint
  if (isGradient(paint)) {
    return gradientFor(
      paint.type === 'radial' ? 'radial' : 'linear',
      paint.type === 'radial' ? 0 : paint.angle ?? 0,
      stopsOf(paint.stops ?? []),
      opts,
    )
  }
  if (isFill(paint)) {
    if (paint.type === 'solid') return paint.a
    if (paint.type === 'gradient') return gradientFor('linear', paint.angle, fillGradientStops(paint), opts)
    return null
  }
  return null
}

/** Which export tier a paint lands in TODAY — `vector` when
 *  `paintToVectorPaint` can express it, `flat` when the caller still has to
 *  degrade to a representative colour. Task 7 turns the second one into
 *  something the user is told about; this is only the fact, not the wording. */
export function paintIsVector(paint: Paint | undefined): boolean {
  return paintToVectorPaint(paint, { units: 'objectBoundingBox' }) !== null
}
