/**
 * Vector Type Studio — the two renderers.
 *
 * Both consume the SAME outlines and, critically, the same transformed command
 * lists: `placeOutlines()` does the placement once and `outlinesToPath2D` /
 * `outlinesToSVG` only differ in how they replay it. That is what makes the SVG
 * export a genuine export rather than a second, drifting implementation — the
 * `d` attribute and the Path2D describe identical geometry by construction, and
 * a unit test pins it.
 *
 * The transform is baked into the coordinates rather than left to a
 * `ctx.scale(1, -1)` at the call site. Font space is y-up with the baseline at
 * 0; canvas and SVG are y-down. Baking the flip means stroke widths, dashes and
 * per-glyph stagger transforms are all in output units on both surfaces, and the
 * SVG needs no wrapper transform to match what the canvas drew.
 *
 * The SVG WRITER itself is not here — it lives in `~/lib/vector/svg` and knows
 * nothing about type. Shape Studio is its intended second consumer: project its
 * flat-shaded facets to polygons and call `shapesToSVG` directly. Everything
 * below is the type-specific adapter over that spine.
 */
import type { SvgDocOptions, Transform2D, VectorCommand, VectorPaint, VectorRect, VectorShape } from '~/lib/vector/svg'
import { blurRadiusToStdDeviation, shapesToSVG, transformCommands } from '~/lib/vector/svg'
import type { VtCurveTable } from './curve'
import { pointAtLength } from './curve'
import type { GlyphOutline, TextOutlines, VtBBox } from './outline'

export type { Transform2D, VectorGradient, VectorPaint, VectorRect, VectorShape } from '~/lib/vector/svg'
/** Re-exported so a second studio can reach the spine without importing
 *  anything type-specific. */
export { blurRadiusToStdDeviation, controlPointBounds, shapesToSVG } from '~/lib/vector/svg'

/**
 * The CURVE a run is placed along — the arc feature, as one option on the
 * placement.
 *
 * Everything about it is in OUTPUT units (the same units `scale` produces), which
 * is a decision and not a default: glyph advances arrive from fontkit in FONT
 * units, so the accumulated distance and the curve's own size have to be brought
 * into one space or an arc radius would mean a different shape at every `size`.
 * Output units is the house convention — `extrude.ts`'s `dx`/`dy` and
 * `strokeWidth` are already output pixels for the same reason.
 *
 * The TABLE, not the curve: `pointAtLength` accepts a bare curve as a
 * convenience and rebuilds the table on every call, which in a glyph loop is
 * O(samples) per letter. Build it once per run (`buildCurveTable`) and hand it
 * in.
 */
export interface RunCurve {
  /** Arc-length table over a curve in OUTPUT units. Build once per run. */
  table: VtCurveTable
  /** Arc length at which the run's PEN starts, i.e. where `glyph.x === 0` lands.
   *  Default 0, which starts the run at the curve's own start. */
  offset?: number
}

/** Where a glyph run lands in output units. Defaults: scale 1, no rotation, no
 *  offset, y flipped, no curve. */
export interface PlacementOptions extends Transform2D {
  /** Place the glyphs along this curve instead of along a straight baseline.
   *  Absent or `null` is the flat run, byte-identical to what it always was. */
  curve?: RunCurve | null
}

/** A fully-resolved placement: every `Transform2D` field decided, plus the run's
 *  curve if it has one. What `vtPlacement` hands the renderers. */
export interface ResolvedPlacement extends Required<Transform2D> {
  curve?: RunCurve | null
}

/** Fit a run into a box, preserving aspect and centring. */
export interface FitOptions {
  width: number
  height: number
  /** Output-unit margin kept clear on every side. Default 0. */
  padding?: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

function resolve(t: PlacementOptions = {}): Required<Transform2D> {
  return {
    scale: Number.isFinite(t.scale as number) ? (t.scale as number) : 1,
    rotate: Number.isFinite(t.rotate as number) ? (t.rotate as number) : 0,
    x: Number.isFinite(t.x as number) ? (t.x as number) : 0,
    y: Number.isFinite(t.y as number) ? (t.y as number) : 0,
    flipY: t.flipY !== false,
  }
}

/**
 * The transform that centres `bbox` inside a `width` × `height` box.
 *
 * Uses the run's INK bounds, not its advance width and em box — for display
 * type that is what "centred" actually looks like, and it is why the demo had
 * to fudge a `h * 0.34` baseline offset by hand.
 */
export function fitTransform(bbox: VtBBox, opts: FitOptions): Required<Transform2D> {
  const pad = opts.padding ?? 0
  const availW = Math.max(0, opts.width - pad * 2)
  const availH = Math.max(0, opts.height - pad * 2)
  const bw = bbox.maxX - bbox.minX
  const bh = bbox.maxY - bbox.minY
  const scale = bw > 0 && bh > 0 ? Math.min(availW / bw, availH / bh) : 1
  return {
    scale,
    rotate: 0,
    x: pad + (availW - bw * scale) / 2 - bbox.minX * scale,
    // y-flipped: the source's MAX y becomes the output's top edge.
    y: pad + (availH - bh * scale) / 2 + bbox.maxY * scale,
    flipY: true,
  }
}

/**
 * The transform for one glyph = the run placement plus that glyph's own origin.
 *
 * `x`/`y` is the glyph's placed **baseline-left origin** in output space, and
 * that meaning is unchanged on a curve — every existing caller (the motion
 * pivot, the cell clip, the extrude step, the glyph paint box) reads it as
 * exactly that. What a curve adds is `rotate`.
 *
 * ## Placement on a curve — `utils/textOnPath.ts:169-188`'s algorithm
 *
 * Accumulate half an advance, place the glyph's CENTRE at that arc length, and
 * turn the glyph to the tangent there. Two deliberate differences from the
 * widget:
 *
 *  - the advances are **fontkit's shaped `xAdvance`**, kerning, ligatures and
 *    GPOS included (`glyph.x` is already the shaped pen position with the
 *    studio's own `tracking` folded in by `vectorTypeFrame`), where the widget
 *    measures single characters with `ctx.measureText` and so has none of it;
 *  - the distance is inverted to a curve parameter through the **arc-length
 *    table** (`pointAtLength`), where the widget maps `distance ÷ length`
 *    straight back to `t`. That is only correct on a constant-speed curve; on a
 *    wave it bunches glyphs over the crests by 36 % (measured in `./curve.ts`'s
 *    spec).
 *
 * No loop state is needed and none is kept: `glyph.x` IS the accumulated
 * advance, so the placement of glyph *i* is a pure function of glyph *i*. That
 * is the property `./outline.ts`'s header describes — *"placement into the line
 * is carried separately on `x`/`y` rather than baked into the commands"* — and
 * it is what makes an arc cost one binary search per glyph instead of a
 * re-shaping.
 *
 * The half-advance is then walked BACK along the tangent, because what this
 * returns is the origin (the left edge) and what the curve positioned is the
 * centre.
 */
export function glyphTransform(glyph: GlyphOutline, t: PlacementOptions = {}): Required<Transform2D> {
  const r = resolve(t)
  const fy = r.flipY ? -r.scale : r.scale
  // The run-level rotation, about the run's own placement origin. Zero for every
  // config the studio can currently produce; written out so `rotate` on the
  // placement means the same thing at both levels rather than being a field only
  // the curve is allowed to set.
  const rr = r.rotate * DEG_TO_RAD
  const rc = r.rotate === 0 ? 1 : Math.cos(rr)
  const rs = r.rotate === 0 ? 0 : Math.sin(rr)

  // ── The flat run ───────────────────────────────────────────────────────────
  if (!t.curve) {
    const px = glyph.x * r.scale
    const py = glyph.y * fy
    return {
      scale: r.scale,
      rotate: r.rotate,
      x: r.x + px * rc - py * rs,
      y: r.y + px * rs + py * rc,
      flipY: r.flipY,
    }
  }

  // ── On the curve ───────────────────────────────────────────────────────────
  const half = (glyph.advance / 2) * r.scale
  const s = (t.curve.offset ?? 0) + glyph.x * r.scale + half
  const p = pointAtLength(t.curve.table, s)
  const gc = Math.cos(p.angle)
  const gs = Math.sin(p.angle)
  // The origin, in the CURVE's frame: back off half an advance along the
  // tangent, and carry the glyph's own y offset (GPOS mark placement) on the
  // curve's NORMAL rather than on the output's vertical — an accent belongs over
  // its letter, not over the canvas.
  const lx = -half
  const ly = glyph.y * fy
  const cx = p.x + lx * gc - ly * gs
  const cy = p.y + lx * gs + ly * gc
  return {
    scale: r.scale,
    rotate: r.rotate + p.angle * RAD_TO_DEG,
    x: r.x + cx * rc - cy * rs,
    y: r.y + cx * rs + cy * rc,
    flipY: r.flipY,
  }
}

/**
 * The union of every glyph's INK, PLACED — in OUTPUT units.
 *
 * `TextOutlines.bbox` cannot answer this once a curve or a rotation is in play:
 * it is the run's bounds in FONT units on a straight baseline, and a rotated
 * glyph's axis-aligned box is not its unrotated box scaled. This transforms each
 * glyph's own tight bounds by that glyph's own placement and unions the result,
 * which is exact for the corners and — since a glyph's outline never leaves its
 * fontkit bbox — an upper bound that is tight in the flat case.
 *
 * Ink only: a blank (a space) contributes nothing, exactly as it contributes
 * nothing to `TextOutlines.bbox`. A run with no ink at all degenerates to a
 * zero-extent box at the placement's own origin, which is what the flat
 * arithmetic this replaces produced for the same input.
 */
export function placedInkBounds(outlines: TextOutlines, opts: PlacementOptions = {}): VtBBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const g of outlines.glyphs) {
    if (!g.commands.length) continue
    const t = glyphTransform(g, opts)
    const s = t.scale
    const fy = t.flipY ? -s : s
    const rad = t.rotate * DEG_TO_RAD
    const cos = t.rotate === 0 ? 1 : Math.cos(rad)
    const sin = t.rotate === 0 ? 0 : Math.sin(rad)
    const b = g.bbox
    for (const [bx, by] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]] as const) {
      const px = bx * s
      const py = by * fy
      const x = t.x + px * cos - py * sin
      const y = t.y + px * sin + py * cos
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (Number.isFinite(minX)) return { minX, minY, maxX, maxY }
  const r = resolve(opts)
  return { minX: r.x, minY: r.y, maxX: r.x, maxY: r.y }
}

/**
 * Where the baseline sits inside a glyph's CELL BOX, as a fraction of the em.
 *
 * The cell box is one em tall, not the font's line box, and that is a
 * deliberate choice: a mask `amount` is a FRACTION of the animated unit's box,
 * and this studio's unit box is the em — it is what the preset evaluator
 * multiplies `dx`, `dy` and `blur` by (`size` = em height in output px, CSS
 * `font-size` semantics). Measuring the mask against a font-metric line box
 * instead would silently make a reveal refer to a different unit than the
 * offsets do. 0.8/0.2 is the conventional CSS-ish split.
 */
export const CELL_DESCENT = 0.2

/** A one-sided reveal: `amount` is the fraction of the cell hidden from `side`.
 *  Structural on purpose — `presetMotion`'s `VtGlyphClip` satisfies it, and this
 *  module stays out of the motion model's import graph. */
export interface GlyphClip {
  side: 'top' | 'bottom' | 'left' | 'right'
  amount: number
}

/**
 * One glyph's mask window, in OUTPUT space — the ONE definition of it.
 *
 * Both renderers call this: the canvas hands it to `ctx.rect` + `ctx.clip()`,
 * the SVG writer emits it as a `<clipPath><rect>`. A second derivation would
 * drift, and the drift would be invisible — both surfaces would still show a
 * plausibly masked glyph.
 *
 * `origin` is the glyph's PLACED BASELINE (`glyphTransform`), `advance` its
 * advance in output pixels and `em` the em in output pixels. Only the axis the
 * mask moves on is measured against the cell; the perpendicular axis is padded
 * by an em so a descender's tail or an italic overhang is not sliced off by the
 * sides of the window. The masked axis is NOT padded — `amount === 1` has to
 * leave a zero-extent window, or an entrance would begin with the bottom of a
 * 'g' already showing.
 *
 * The window is FIXED in output space. Whatever transform the glyph carries is
 * applied to the glyph and not to this rect, so the letter slides THROUGH the
 * window rather than dragging it along.
 */
export function glyphCellClipRect(
  origin: { x: number; y: number },
  advance: number,
  em: number,
  clip: GlyphClip,
): VectorRect {
  const a = clip.amount < 0 ? 0 : clip.amount > 1 ? 1 : clip.amount
  const x0 = origin.x
  const x1 = origin.x + advance
  // The origin is the glyph's placed BASELINE, and the cell hangs around it.
  const y1 = origin.y + em * CELL_DESCENT
  const y0 = y1 - em

  let bx0 = x0, bx1 = x1, by0 = y0, by1 = y1
  if (clip.side === 'top' || clip.side === 'bottom') {
    bx0 -= em; bx1 += em
    if (clip.side === 'top') by0 = y0 + em * a
    else by1 = y1 - em * a
  } else {
    by0 -= em; by1 += em
    if (clip.side === 'left') bx0 = x0 + advance * a
    else bx1 = x1 - advance * a
  }

  return { x: bx0, y: by0, width: Math.max(0, bx1 - bx0), height: Math.max(0, by1 - by0) }
}

/**
 * Outlines → one command list per glyph, in OUTPUT space.
 *
 * The single source of truth for both renderers. Nothing below re-derives
 * coordinates; they only replay these.
 */
export function placeOutlines(outlines: TextOutlines, opts: PlacementOptions = {}): VectorCommand[][] {
  return outlines.glyphs.map(g => transformCommands(g.commands, glyphTransform(g, opts)))
}

/** Minimal structural type for Path2D, so this module does not require DOM libs. */
interface Path2DLike {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  closePath(): void
}

/**
 * Outlines → one `Path2D` per glyph, ready to `ctx.fill()` with no further
 * transform. One path per glyph (not one for the run) so per-glyph stagger can
 * transform each independently.
 *
 * Throws where `Path2D` does not exist (SSR, a worker without OffscreenCanvas).
 * Use `outlinesToSVG` or `placeOutlines` in those contexts — that is the point
 * of keeping the geometry pure.
 */
export function outlinesToPath2D(outlines: TextOutlines, opts: PlacementOptions = {}): Path2D[] {
  return placeOutlines(outlines, opts).map(commands => commandsToPath2D(commands))
}

/**
 * One already-placed command list → a `Path2D`.
 *
 * Extracted from `outlinesToPath2D` so the SOLID extrude (`./extrudeSolid.ts`)
 * can replay a UNIONED body — which is a command list in the same output space,
 * but not one that came from a glyph — through the identical switch. Two replays
 * of the same five commands is a second place for a `quadraticCurveTo` to be
 * forgotten, and the symptom would be a body with a subtly wrong contour.
 *
 * Throws where `Path2D` does not exist (SSR, a worker without OffscreenCanvas).
 */
export function commandsToPath2D(commands: readonly VectorCommand[]): Path2D {
  const Ctor = (globalThis as any).Path2D as (new () => Path2DLike) | undefined
  if (typeof Ctor !== 'function') {
    throw new Error('commandsToPath2D: Path2D is unavailable in this environment')
  }
  const p = new Ctor()
  for (const c of commands) {
    const a = c.args
    switch (c.command) {
      case 'moveTo': p.moveTo(a[0] as number, a[1] as number); break
      case 'lineTo': p.lineTo(a[0] as number, a[1] as number); break
      case 'quadraticCurveTo': p.quadraticCurveTo(a[0] as number, a[1] as number, a[2] as number, a[3] as number); break
      case 'bezierCurveTo': p.bezierCurveTo(a[0] as number, a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number); break
      case 'closePath': p.closePath(); break
    }
  }
  return p as unknown as Path2D
}

/** Paint for the glyph run. A function form gets called per glyph, which is how
 *  per-glyph colour staggers get expressed without a second render path — and,
 *  now that `fill` can be a gradient paint server, how a run-anchored ramp gets
 *  each glyph the `gradientTransform` that pins it (see `VectorGradient`). */
export interface GlyphPaint {
  fill?: VectorPaint | null | ((glyph: GlyphOutline, index: number) => VectorPaint | null)
  stroke?: string | null | ((glyph: GlyphOutline, index: number) => string | null)
  /**
   * In OUTPUT units, so it does not shrink when the type is scaled down.
   *
   * A FUNCTION form for the same reason `stroke` has one, and it is load-bearing
   * for exactly one caller: a solid extrude layer emits ONE fused body for the
   * glyphs whose union has landed and `depth` separate copies for the rest, and
   * only the former may be stroked — a width written across the whole layer would
   * outline every copy of the latter and put seam lines through the block. Per
   * glyph, the two answers can differ; as a scalar they could not.
   */
  strokeWidth?: number | ((glyph: GlyphOutline, index: number) => number | undefined)
  /** Glyph outlines rely on nonzero winding for counters. Change with care. */
  fillRule?: 'nonzero' | 'evenodd'
  /**
   * 0..1, per glyph. The canvas renderer expresses a per-glyph motion opacity as
   * `ctx.globalAlpha`; without this the SVG has nowhere to put it and a fading
   * stagger exports fully opaque.
   */
  opacity?: number | ((glyph: GlyphOutline, index: number) => number)
  /**
   * Per-glyph blur, as `feGaussianBlur`'s `stdDeviation` in OUTPUT units.
   *
   * The canvas expresses this as `ctx.filter = 'blur(Npx)'`; without it here a
   * `blur-in` entrance exports perfectly sharp. Pass the canvas radius through
   * `blurRadiusToStdDeviation` — they are the same quantity, but saying so at
   * the call site is what stops someone "fixing" it with a factor of two.
   */
  blur?: number | ((glyph: GlyphOutline, index: number) => number)
  /**
   * Per-glyph mask window, in OUTPUT space — see `glyphCellClipRect`, which is
   * what both renderers use to compute it. The canvas expresses this as a
   * `ctx.clip()` taken BEFORE the per-glyph transform; the spine's `<clipPath>`
   * rides on an untransformed wrapper `<g>` for the same reason.
   */
  clip?:
    | VectorRect
    | null
    | ((glyph: GlyphOutline, index: number) => VectorRect | null | undefined)
  /**
   * Extra attributes on each glyph's `<path>`.
   *
   * This is how a per-glyph MOTION transform survives export: the canvas replays
   * translate/rotate/scale around the glyph's own origin as `ctx` operations,
   * and an SVG `transform` list composes in the same order, so the caller can
   * hand the identical composition through here. It is kept as an open attribute
   * bag rather than a typed `transform` field so the spine stays free of any one
   * studio's motion model.
   */
  attrs?:
    | Record<string, string | number>
    | ((glyph: GlyphOutline, index: number) => Record<string, string | number> | undefined)
  /**
   * One glyph → **K command lists**, in paint order — the seam that lets a
   * single appearance layer emit more than one `<path>` per letter.
   *
   * `outlinesToShapes` already returned an array, so this is a `flatMap` and
   * nothing downstream changes: the spine writes whatever shapes it is handed.
   * Vector Type's EXTRUDE layer is the first caller — it returns `depth` offset
   * copies of the glyph (`extrudeCopyCommands`), or the ONE fused body of a
   * solid extrude.
   *
   * Every list produced for a glyph shares that glyph's resolved paint, opacity,
   * blur, clip and attributes: they are the same layer's ink on the same letter,
   * differing only in geometry. That is exactly what the canvas does — `pm` and
   * the resolved style are computed once per (layer, glyph) and replayed per
   * copy — and it is why the paint is picked BEFORE the expansion below rather
   * than per shape.
   *
   * Returning `undefined`/`null` means "no expansion": the glyph emits its own
   * single shape, byte-identical to what it emitted before this option existed.
   * Returning an EMPTY array means "nothing for this glyph" and emits no shape
   * at all — a real answer (a budget-shortened extrude, an ink-less space), not
   * a synonym for the default.
   *
   * Structural on purpose: it takes command lists and returns command lists, so
   * this module stays out of the extrude model's import graph.
   */
  expand?: (
    commands: VectorCommand[],
    glyph: GlyphOutline,
    index: number,
  ) => VectorCommand[][] | null | undefined
}

function pick<T>(
  v: T | ((glyph: GlyphOutline, index: number) => T) | undefined,
  glyph: GlyphOutline,
  index: number,
): T | undefined {
  return typeof v === 'function' ? (v as (g: GlyphOutline, i: number) => T)(glyph, index) : v
}

/**
 * Outlines → paintable shapes in output space. The bridge to the spine.
 *
 * ONE shape per glyph by default, and K per glyph when `expand` says so — an
 * appearance layer that draws the same letter several times (an extrude) is a
 * `flatMap`, not a second render path.
 */
export function outlinesToShapes(
  outlines: TextOutlines,
  opts: PlacementOptions & GlyphPaint = {},
): VectorShape[] {
  const placed = placeOutlines(outlines, opts)
  return placed.flatMap((commands, i) => {
    const glyph = outlines.glyphs[i] as GlyphOutline
    const attrs = pick(opts.attrs, glyph, i)
    const opacity = pick(opts.opacity, glyph, i)
    const blur = pick(opts.blur, glyph, i)
    const clip = pick(opts.clip, glyph, i)
    const fill = pick(opts.fill, glyph, i)
    const style = {
      // `undefined` means "nobody said", which keeps the historical black
      // default. `null` is a caller SAYING "no fill" and must survive as the
      // spine's explicit `fill="none"` — a stroke-only layer is exactly that,
      // and collapsing it to black would paint the letter solid.
      fill: fill === undefined ? '#000000' : fill,
      stroke: pick(opts.stroke, glyph, i),
      strokeWidth: pick(opts.strokeWidth, glyph, i),
      fillRule: opts.fillRule ?? 'nonzero',
      // Omitted rather than written as 1 — a fully opaque glyph should not carry
      // a redundant attribute into a file a designer is going to read. Same for
      // a zero blur and an absent clip: no `<defs>` entry, no wrapper `<g>`.
      ...(opacity === undefined || opacity === 1 ? {} : { opacity }),
      ...(blur === undefined || !(blur > 0) ? {} : { blur }),
      ...(clip ? { clip } : {}),
      ...(attrs && Object.keys(attrs).length ? { attrs } : {}),
    }
    // The paint above is resolved ONCE for the glyph and shared by every command
    // list below — see `GlyphPaint.expand`. `undefined`/`null` is "no expansion"
    // and emits the glyph's own single shape; `[]` emits none.
    const parts = opts.expand ? opts.expand(commands, glyph, i) : null
    if (!parts) return [{ ...style, commands }]
    return parts.map(cmds => ({ ...style, commands: cmds }))
  })
}

export interface OutlinesSvgOptions extends PlacementOptions, GlyphPaint, SvgDocOptions {
  /** Margin around the ink when the document size is derived. Default 0. */
  padding?: number
}

/**
 * Outlines → a standalone SVG document.
 *
 * A thin adapter, on purpose: it places the glyphs, paints them, and hands plain
 * shapes to `shapesToSVG`. With no `width`/`height`/`viewBox` given it sizes the
 * document to the placed ink plus `padding`, so the default export is cropped
 * rather than sitting somewhere in an arbitrary canvas.
 */
export function outlinesToSVG(outlines: TextOutlines, opts: OutlinesSvgOptions = {}): string {
  const shapes = outlinesToShapes(outlines, opts)
  const pad = opts.padding ?? 0

  let viewBox = opts.viewBox
  if (!viewBox) {
    // The PLACED ink, per glyph. Identical to the old "source bbox through the
    // placement transform" arithmetic for a flat run — asserted by a test — and
    // the only form that stays correct once a glyph can be turned to a curve,
    // where the run's axis-aligned bounds are not its font-space bounds scaled.
    const b = placedInkBounds(outlines, opts)
    const minX = b.minX - pad
    const minY = b.minY - pad
    viewBox = [minX, minY, b.maxX - minX + pad, b.maxY - minY + pad]
  }

  return shapesToSVG(shapes, {
    width: opts.width,
    height: opts.height,
    viewBox,
    background: opts.background,
    precision: opts.precision,
    groupAttrs: opts.groupAttrs,
    idPrefix: opts.idPrefix,
  })
}
