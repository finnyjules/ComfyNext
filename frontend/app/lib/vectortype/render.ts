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
import type { GlyphOutline, TextOutlines, VtBBox } from './outline'

export type { Transform2D, VectorGradient, VectorPaint, VectorRect, VectorShape } from '~/lib/vector/svg'
/** Re-exported so a second studio can reach the spine without importing
 *  anything type-specific. */
export { blurRadiusToStdDeviation, controlPointBounds, shapesToSVG } from '~/lib/vector/svg'

/** Where a glyph run lands in output units. Defaults: scale 1, no offset, y flipped. */
export type PlacementOptions = Transform2D

/** Fit a run into a box, preserving aspect and centring. */
export interface FitOptions {
  width: number
  height: number
  /** Output-unit margin kept clear on every side. Default 0. */
  padding?: number
}

function resolve(t: PlacementOptions = {}): Required<Transform2D> {
  return {
    scale: Number.isFinite(t.scale as number) ? (t.scale as number) : 1,
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
    x: pad + (availW - bw * scale) / 2 - bbox.minX * scale,
    // y-flipped: the source's MAX y becomes the output's top edge.
    y: pad + (availH - bh * scale) / 2 + bbox.maxY * scale,
    flipY: true,
  }
}

/** The transform for one glyph = the run placement plus that glyph's own origin. */
export function glyphTransform(glyph: GlyphOutline, t: PlacementOptions = {}): Required<Transform2D> {
  const r = resolve(t)
  return {
    scale: r.scale,
    x: r.x + glyph.x * r.scale,
    y: r.y + glyph.y * (r.flipY ? -r.scale : r.scale),
    flipY: r.flipY,
  }
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
  const Ctor = (globalThis as any).Path2D as (new () => Path2DLike) | undefined
  if (typeof Ctor !== 'function') {
    throw new Error('outlinesToPath2D: Path2D is unavailable in this environment')
  }
  return placeOutlines(outlines, opts).map(commands => {
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
  })
}

/** Paint for the glyph run. A function form gets called per glyph, which is how
 *  per-glyph colour staggers get expressed without a second render path — and,
 *  now that `fill` can be a gradient paint server, how a run-anchored ramp gets
 *  each glyph the `gradientTransform` that pins it (see `VectorGradient`). */
export interface GlyphPaint {
  fill?: VectorPaint | null | ((glyph: GlyphOutline, index: number) => VectorPaint | null)
  stroke?: string | null | ((glyph: GlyphOutline, index: number) => string | null)
  /** In OUTPUT units, so it does not shrink when the type is scaled down. */
  strokeWidth?: number
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
}

function pick<T>(
  v: T | ((glyph: GlyphOutline, index: number) => T) | undefined,
  glyph: GlyphOutline,
  index: number,
): T | undefined {
  return typeof v === 'function' ? (v as (g: GlyphOutline, i: number) => T)(glyph, index) : v
}

/** Outlines → paintable shapes in output space. The bridge to the spine. */
export function outlinesToShapes(
  outlines: TextOutlines,
  opts: PlacementOptions & GlyphPaint = {},
): VectorShape[] {
  const placed = placeOutlines(outlines, opts)
  return placed.map((commands, i) => {
    const glyph = outlines.glyphs[i] as GlyphOutline
    const attrs = pick(opts.attrs, glyph, i)
    const opacity = pick(opts.opacity, glyph, i)
    const blur = pick(opts.blur, glyph, i)
    const clip = pick(opts.clip, glyph, i)
    return {
      commands,
      fill: pick(opts.fill, glyph, i) ?? '#000000',
      stroke: pick(opts.stroke, glyph, i),
      strokeWidth: opts.strokeWidth,
      fillRule: opts.fillRule ?? 'nonzero',
      // Omitted rather than written as 1 — a fully opaque glyph should not carry
      // a redundant attribute into a file a designer is going to read. Same for
      // a zero blur and an absent clip: no `<defs>` entry, no wrapper `<g>`.
      ...(opacity === undefined || opacity === 1 ? {} : { opacity }),
      ...(blur === undefined || !(blur > 0) ? {} : { blur }),
      ...(clip ? { clip } : {}),
      ...(attrs && Object.keys(attrs).length ? { attrs } : {}),
    }
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
  const t = resolve(opts)
  const shapes = outlinesToShapes(outlines, opts)
  const pad = opts.padding ?? 0

  let viewBox = opts.viewBox
  if (!viewBox) {
    const b = outlines.bbox
    // The source bbox, through the same transform the commands went through.
    const xs = [t.x + b.minX * t.scale, t.x + b.maxX * t.scale]
    const sy = t.flipY ? -t.scale : t.scale
    const ys = [t.y + b.minY * sy, t.y + b.maxY * sy]
    const minX = Math.min(...xs) - pad
    const minY = Math.min(...ys) - pad
    viewBox = [minX, minY, Math.max(...xs) - minX + pad, Math.max(...ys) - minY + pad]
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
