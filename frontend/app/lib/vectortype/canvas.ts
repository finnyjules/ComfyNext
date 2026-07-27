/**
 * Vector Type Studio — the ONE canvas render path.
 *
 * Four consumers need to turn `(config, time) -> pixels`: the editor surface's
 * preview loop, the node card's live preview, the cascade baker (PNG), and the
 * `StudioFrameSource` a downstream studio pulls frames from. Every one of them
 * goes through `drawVectorType` below.
 *
 * That is not tidiness — it is the "Smart Layout render parity" lesson: three
 * surfaces each grew their own copy of the render and drifted, and the drift is
 * invisible (each one renders SOMETHING). Placement, tracking, alignment and the
 * per-glyph stagger transform are decided here, once.
 *
 * ## The control semantics this implements (Task 5 spelled them out; nothing
 * upstream applies them)
 *
 *  - `size`     — em size in OUTPUT PIXELS, CSS `font-size` semantics.
 *                 `scale = size / unitsPerEm`.
 *  - `tracking` — extra advance per glyph in 1/1000 em, applied AFTER the font's
 *                 own shaping (so kerning survives). Not added after the last
 *                 glyph, so a centred run stays centred.
 *  - `align`    — horizontal anchoring of the run's INK inside the output box.
 *                 Vertical is always centred (v1 is single-line).
 *  - `strokeWidth` — OUTPUT pixels, so it does not shrink as `size` drops.
 *
 * ## The name collision, resolved
 *
 * `./render.ts` and `./motion.ts` both export `glyphTransform` and they mean
 * different things — WHERE the glyph sits vs WHAT motion adds to that. Both are
 * needed here, so both are aliased at the import site (`glyphPlacement` /
 * `glyphMotion`). Task 6 chose the collision deliberately so a module using both
 * has to say which it means; this is that module saying it.
 */
import type { Transform2D } from '~/lib/vector/svg'
import { formatNumber } from '~/lib/vector/svg'
import type { VectorTypeConfig } from './config'
import type { VtFont } from './font'
import type { GlyphOutline, TextOutlines } from './outline'
import { textOutlines } from './outline'
import {
  IDENTITY_GLYPH_TRANSFORM,
  applyMotion,
  glyphConfig,
  resolveStagger,
  type VtGlyphTransform,
} from './motion'
import { vtEmSize, vtGlyphMotion, vtHasPreset, type VtGlyphMotion } from './presetMotion'
import { glyphTransform as glyphPlacement, outlinesToPath2D, outlinesToSVG } from './render'

/** One frame's worth of resolved geometry: what to draw and how each glyph moves. */
export interface VtFrame {
  /** The run, in FONT UNITS, with tracking already folded into the pen positions. */
  outlines: TextOutlines
  /** The config at this instant, on the shared (un-staggered) clock. Paint, size,
   *  tracking and align are read from here — they are run-level, not per-glyph. */
  config: VectorTypeConfig
  /** Per-glyph motion, index-aligned with `outlines.glyphs`: the axis TRACKS and
   *  the entrance/exit/loop PRESETS composed into one state (see
   *  `./presetMotion.ts`). A superset of `VtGlyphTransform` — the extra fields
   *  (`blur`, `clip`, `scaleX/scaleY`, `axes`) are carried for the renderers that
   *  consume them; the five transform fields are what this module draws with. */
  transforms: VtGlyphMotion[]
  /** True when at least one glyph was shaped at its own axis position — i.e. the
   *  travelling-wave path actually ran. Exposed so a caller can ASSERT the
   *  intended path executed rather than inferring it from the picture. */
  staggered: boolean
  /** How many distinct `textOutlines` shapings this frame cost. 1 when the whole
   *  run shares one clock; up to `glyphs.length` when a wave is travelling. */
  shapings: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** A stable key for a coords record, so two glyphs that land on the same axis
 *  position share one `getVariation` instance instead of paying for it twice. */
function coordsKey(coords: Record<string, number>): string {
  const tags = Object.keys(coords).sort()
  let out = ''
  for (const tag of tags) out += `${tag}:${coords[tag]};`
  return out
}

/**
 * Shape the run at time `t`, giving each glyph its OWN axis position when
 * stagger is on.
 *
 * This is the studio's headline capability, and it is the expensive one: a
 * travelling wave means glyph *i* sits at a different axis position from glyph
 * *i+1*, so fontkit must instance the font once per distinct coordinate set.
 * Two mitigations, both cheap:
 *
 *  - `delay === 0` collapses to a SINGLE shaping (Task 6 proved the collapse is
 *    exact), so the common case pays nothing.
 *  - identical coordinate sets are memoised within the frame, so a `center` or
 *    `edges` order — where glyphs pair up — costs about half.
 *
 * Advances come from each glyph's own instance, so the word BREATHES as the wave
 * passes. That is the font's real metric at that axis position; freezing the
 * layout at the base weight would make heavy glyphs collide.
 */
export function vectorTypeFrame(font: VtFont, cfg: VectorTypeConfig, t: number): VtFrame {
  const base = applyMotion(cfg, t)
  const upem = font.unitsPerEm || 1000
  const shaped = textOutlines(font, base.text, base.axes)
  const n = shaped.glyphs.length

  const stagger = resolveStagger(cfg)
  const perGlyph = stagger.delay > 0 && n > 1
  const cache = new Map<string, TextOutlines>()
  cache.set(coordsKey(shaped.coords), shaped)

  const source: GlyphOutline[] = []
  if (perGlyph) {
    for (let i = 0; i < n; i++) {
      const gc = glyphConfig(cfg, t, i, n)
      // Shape through the SAME entry point, so the axis clamping and the sparse-
      // axes contract are identical to the un-staggered path.
      const probeCoords = { ...shaped.coords, ...gc.axes }
      const key = coordsKey(probeCoords)
      let run = cache.get(key)
      if (!run) {
        run = textOutlines(font, base.text, gc.axes)
        cache.set(key, run)
      }
      source.push((run.glyphs[i] ?? shaped.glyphs[i]) as GlyphOutline)
    }
  } else {
    source.push(...shaped.glyphs)
  }

  // Re-accumulate the pen with tracking. Not added after the LAST glyph: CSS
  // letter-spacing does add it there, and the result is a run whose ink is
  // half a space off-centre at every non-zero tracking.
  const extra = (base.tracking / 1000) * upem
  const glyphs: GlyphOutline[] = []
  let penX = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < source.length; i++) {
    const g = source[i] as GlyphOutline
    const placed: GlyphOutline = { ...g, x: penX, y: g.y }
    glyphs.push(placed)
    if (g.commands.length) {
      minX = Math.min(minX, placed.x + g.bbox.minX)
      minY = Math.min(minY, placed.y + g.bbox.minY)
      maxX = Math.max(maxX, placed.x + g.bbox.maxX)
      maxY = Math.max(maxY, placed.y + g.bbox.maxY)
    }
    penX += g.advance + (i < source.length - 1 ? extra : 0)
  }

  const bbox = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  // One em for the whole run, resolved once: `vtPlacement` scales every glyph by
  // the SAME `size`, so a per-glyph em would move the letters in units the
  // geometry does not share.
  const em = vtEmSize(cfg, t)
  const transforms: VtGlyphMotion[] = []
  for (let i = 0; i < glyphs.length; i++) transforms.push(vtGlyphMotion(cfg, t, i, glyphs.length, em))

  return {
    outlines: { glyphs, width: penX, unitsPerEm: upem, coords: shaped.coords, bbox },
    config: base,
    transforms,
    staggered: perGlyph,
    shapings: cache.size,
  }
}

export interface VtBoxOptions {
  /** Logical output width in pixels. */
  width: number
  /** Logical output height in pixels. */
  height: number
  /** Output-unit margin kept clear on every side. Default 0. */
  padding?: number
}

/**
 * Where the run lands in the output box: `size` decides the scale (this is NOT a
 * fit-to-box — the type is the size the user asked for, and overflowing is a
 * legitimate composition), `align` decides the horizontal anchor, and the ink is
 * always vertically centred.
 */
export function vtPlacement(frame: VtFrame, opts: VtBoxOptions): Required<Transform2D> {
  const { outlines, config } = frame
  const upem = outlines.unitsPerEm || 1000
  const scale = (Number.isFinite(config.size) ? config.size : 0) / upem
  const pad = opts.padding ?? 0
  const availW = Math.max(0, opts.width - pad * 2)
  const availH = Math.max(0, opts.height - pad * 2)
  const b = outlines.bbox
  const inkW = (b.maxX - b.minX) * scale
  const inkH = (b.maxY - b.minY) * scale

  let x: number
  if (config.align === 'left') x = pad
  else if (config.align === 'right') x = pad + (availW - inkW)
  else x = pad + (availW - inkW) / 2

  return {
    scale,
    x: x - b.minX * scale,
    // y-flipped, so the source's MAX y is the output's TOP edge.
    y: pad + (availH - inkH) / 2 + b.maxY * scale,
    flipY: true,
  }
}

export interface VtDrawOptions extends VtBoxOptions {
  /** Painted before the glyphs. `null`/omitted leaves the canvas transparent. */
  background?: string | null
  /** Device/preview multiplier. The canvas must be `width*pixelRatio` wide. Lets
   *  a 220px card show the SAME composition a 1024px bake produces, rather than
   *  a differently-laid-out one. */
  pixelRatio?: number
}

/**
 * Draw one frame. Returns the resolved frame so a caller can assert on what
 * actually happened (`staggered`, `shapings`, glyph count) instead of trusting
 * that the picture came from the path it thinks it did.
 */
export function drawVectorType(
  ctx: CanvasRenderingContext2D,
  font: VtFont,
  cfg: VectorTypeConfig,
  t: number,
  opts: VtDrawOptions,
): VtFrame {
  const k = opts.pixelRatio && opts.pixelRatio > 0 ? opts.pixelRatio : 1
  const W = Math.max(1, Math.round(opts.width * k))
  const H = Math.max(1, Math.round(opts.height * k))

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, W, H)
  }
  ctx.setTransform(k, 0, 0, k, 0, 0)

  const frame = vectorTypeFrame(font, cfg, t)
  const place = vtPlacement(frame, opts)
  const paths = outlinesToPath2D(frame.outlines, place)
  const { fill, stroke, strokeWidth } = frame.config

  for (let i = 0; i < paths.length; i++) {
    const glyph = frame.outlines.glyphs[i] as GlyphOutline
    const path = paths[i] as Path2D
    const tr = frame.transforms[i] ?? IDENTITY_GLYPH_TRANSFORM
    // The glyph's own placed origin — motion rotates and scales AROUND it, so a
    // spinning glyph spins in place rather than swinging about the canvas corner.
    const origin = glyphPlacement(glyph, place)

    ctx.save()
    ctx.globalAlpha = clamp01(tr.opacity)
    if (tr.dx || tr.dy || tr.rotate || tr.scale !== 1) {
      ctx.translate(origin.x + tr.dx, origin.y + tr.dy)
      if (tr.rotate) ctx.rotate((tr.rotate * Math.PI) / 180)
      if (tr.scale !== 1) ctx.scale(tr.scale, tr.scale)
      ctx.translate(-origin.x, -origin.y)
    }
    ctx.fillStyle = fill
    // nonzero, always: glyph counters (the hole in an 'o') depend on it.
    ctx.fill(path, 'nonzero')
    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth
      ctx.lineJoin = 'round'
      ctx.strokeStyle = stroke
      ctx.stroke(path)
    }
    ctx.restore()
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return frame
}

/** Size `canvas` and draw into it. The convenience wrapper every consumer uses. */
export function drawVectorTypeToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  font: VtFont,
  cfg: VectorTypeConfig,
  t: number,
  opts: VtDrawOptions,
): VtFrame | null {
  const k = opts.pixelRatio && opts.pixelRatio > 0 ? opts.pixelRatio : 1
  const W = Math.max(1, Math.round(opts.width * k))
  const H = Math.max(1, Math.round(opts.height * k))
  if (canvas.width !== W) canvas.width = W
  if (canvas.height !== H) canvas.height = H
  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return null
  return drawVectorType(ctx, font, cfg, t, opts)
}

// ── The vector output ───────────────────────────────────────────────────────
//
// This module is called `canvas.ts` because pixels were its first job, but what
// it really owns is `(config, time) -> a placed, motion-composed frame`. The SVG
// writer below is the SECOND consumer of exactly that, and it lives here rather
// than in `render.ts` for the reason the rest of this file exists: framing,
// tracking, alignment and the per-glyph motion composition must be decided ONCE.
// A separate export path that re-derived any of them would drift, and the drift
// would be invisible — both outputs would still look like the word.
//
// Nothing here is the SVG serialiser. That is `~/lib/vector/svg`, which knows
// nothing about type and is Shape Studio's next consumer; `render.ts` is the
// type-specific adapter over it. This function only decides WHAT to hand it.

/**
 * A per-glyph motion transform as an SVG `transform` list.
 *
 * Mirrors `drawVectorType`'s canvas sequence exactly:
 *
 *   translate(origin + d) · rotate · scale · translate(-origin)
 *
 * An SVG transform list composes left-to-right the same way successive `ctx`
 * operations do, and SVG's `rotate(deg)` turns the same direction as
 * `ctx.rotate(rad)` because both spaces are y-down here (the flip is already
 * baked into the coordinates by `transformCommands`). So the two are the same
 * transform written twice, not two transforms that happen to agree.
 *
 * Returns `undefined` for identity so an unanimated export carries no attribute.
 */
function glyphSvgTransform(
  origin: { x: number; y: number },
  tr: VtGlyphTransform,
  precision = 3,
): string | undefined {
  if (!tr.dx && !tr.dy && !tr.rotate && tr.scale === 1) return undefined
  const n = (v: number) => formatNumber(v, precision)
  const parts = [`translate(${n(origin.x + tr.dx)} ${n(origin.y + tr.dy)})`]
  if (tr.rotate) parts.push(`rotate(${n(tr.rotate)})`)
  if (tr.scale !== 1) parts.push(`scale(${n(tr.scale)})`)
  parts.push(`translate(${n(-origin.x)} ${n(-origin.y)})`)
  return parts.join(' ')
}

export interface VtSvgOptions extends VtBoxOptions {
  /** Painted as a full-bleed rect behind the glyphs, matching the canvas.
   *  `null`/omitted leaves the document transparent. */
  background?: string | null
  /** Decimal places in path data. Default 3 — sub-tenth-of-a-pixel. */
  precision?: number
}

export interface VtSvgResult {
  svg: string
  /** The same `VtFrame` the canvas would have drawn, so a caller can assert the
   *  export came from the path it thinks it did (glyph count, `staggered`,
   *  `shapings`) rather than trusting the picture. */
  frame: VtFrame
}

/**
 * Draw one frame as VECTOR — Sailor's first real vector deliverable.
 *
 * The SVG twin of `drawVectorType`, and deliberately the same three lines of
 * setup: `vectorTypeFrame` for the geometry at time `t`, `vtPlacement` for where
 * it lands in the output box, `glyphPlacement` for each glyph's own origin. Only
 * the replay differs.
 *
 * What comes out is editable geometry: one `<path>` per glyph whose `d` is the
 * glyph's real outline at its real axis position, with `fill`/`stroke` as
 * attributes (never baked into the geometry) and per-glyph motion as a
 * `transform`. No raster, no `<image>`, nothing traced.
 *
 * `t` is a real clock, so exporting mid-animation exports THAT frame — pass the
 * time the surface is showing and the file matches the screen.
 */
export function vectorTypeSVG(
  font: VtFont,
  cfg: VectorTypeConfig,
  t: number,
  opts: VtSvgOptions,
): VtSvgResult {
  const frame = vectorTypeFrame(font, cfg, t)
  const place = vtPlacement(frame, opts)
  const { fill, stroke, strokeWidth } = frame.config
  const precision = opts.precision ?? 3
  const W = Math.max(1, opts.width)
  const H = Math.max(1, opts.height)
  const stroked = Number.isFinite(strokeWidth) && strokeWidth > 0

  const svg = outlinesToSVG(frame.outlines, {
    ...place,
    fill,
    // The stroke is an ATTRIBUTE, not outlined into geometry: a designer opening
    // this can restyle or remove it, and the path still describes the letterform
    // rather than the letterform's outer contour.
    stroke: stroked ? stroke : undefined,
    strokeWidth: stroked ? strokeWidth : undefined,
    fillRule: 'nonzero',
    opacity: (_g, i) => clamp01((frame.transforms[i] ?? IDENTITY_GLYPH_TRANSFORM).opacity),
    attrs: (glyph, i) => {
      const tr = frame.transforms[i] ?? IDENTITY_GLYPH_TRANSFORM
      const transform = glyphSvgTransform(glyphPlacement(glyph, place), tr, precision)
      return transform ? { transform } : undefined
    },
    // The document is the OUTPUT BOX, not a crop of the ink — so the SVG frames
    // the composition exactly as the PNG does and the two can be swapped.
    width: W,
    height: H,
    viewBox: [0, 0, W, H],
    background: opts.background ?? null,
    precision,
    // Matches `ctx.lineJoin = 'round'` in drawVectorType. SVG's default is
    // `miter`, which spikes at the sharp joins letterforms are full of.
    ...(stroked ? { groupAttrs: { 'stroke-linejoin': 'round' } } : {}),
  })

  return { svg, frame }
}

/** A filesystem-safe stem for an export, derived from the text being set. */
export function vtExportName(cfg: VectorTypeConfig | null | undefined): string {
  const slug = String(cfg?.text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug || 'vector-type'
}

/**
 * True when this config has something that MOVES — i.e. a preview loop is worth
 * running, and the frame source should report a real duration.
 *
 * TWO sources now, and both must count. This gated on `tracks.length > 0` alone
 * until presets arrived, which would have made every preset-only config render
 * FROZEN: the surface and the node card would draw a single frame, the frame
 * source would report `duration: 0`, and nothing would error. A picked preset
 * that visibly does nothing reads as "this feature is broken", so the widening
 * ships in the same commit as the evaluator.
 *
 * Stagger alone still is not motion: it shifts a clock nothing is reading.
 */
export function vtIsAnimated(cfg: VectorTypeConfig | null | undefined): boolean {
  const tracks = cfg?.motion?.tracks
  if (Array.isArray(tracks) && tracks.length > 0) return true
  return vtHasPreset(cfg)
}
