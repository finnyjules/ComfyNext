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
import { applyMotion, glyphConfig, resolveStagger } from './motion'
import { vtAxisCoords } from './axisPresets'
import {
  IDENTITY_GLYPH_MOTION,
  vtEmSize,
  vtGlyphMotion,
  vtHasPreset,
  type VtGlyphClip,
  type VtGlyphMotion,
} from './presetMotion'
import {
  blurRadiusToStdDeviation,
  glyphCellClipRect,
  glyphTransform as glyphPlacement,
  outlinesToPath2D,
  outlinesToSVG,
} from './render'

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
  /** True when the glyphs were read on their OWN clocks — the travelling-wave
   *  path. Exposed so a caller can ASSERT the intended path executed rather than
   *  inferring it from the picture. Not the same as "more than one shaping": an
   *  axis PRESET re-shapes the run without a stagger (`shapings` says so). */
  staggered: boolean
  /** How many distinct `textOutlines` shapings this frame cost. 1 when every
   *  glyph shares one axis position; up to `glyphs.length + 1` when a wave is
   *  travelling or an axis preset has moved the run off its resting position. */
  shapings: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Non-zero, sign-preserving: a scale factor of exactly 0 makes the CTM
 *  singular and Chrome then drops the drawing op entirely. The card-flip presets
 *  drive `scaleX`/`scaleY` to their own 0.001 floor; this is the renderer's own
 *  guard so a future preset (or a track) cannot pass a bare 0 through. */
const nonZero = (v: number): number =>
  !Number.isFinite(v) ? 1 : Math.abs(v) >= 0.001 ? v : v < 0 ? -0.001 : 0.001

/**
 * Clip one glyph's cell box — and do it BEFORE the unit transform.
 *
 * That ordering is the whole trick, lifted from `lib/motion/animatedText.ts`
 * (the Compositor's working per-character reveal). The mask is a FIXED WINDOW
 * the letter slides through: `mask-up` starts the glyph a quarter-em low and
 * lifts it while the window opens, so what the viewer sees is a letter rising
 * out of a stationary edge. Clipping after `ctx.translate` would carry the
 * window along with the letter — every frame still shows a plausibly masked
 * glyph, so a thumbnail cannot tell the two apart, and the reveal is gone.
 *
 * WHERE the window is, is `glyphCellClipRect`'s answer and not this function's:
 * the SVG export needs the identical rect for its `<clipPath>`, and a second
 * copy of the cell-box arithmetic is exactly the drift this file exists to
 * prevent. This is only the two `ctx` calls that turn that rect into a clip.
 */
function clipGlyphCell(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  /** The glyph's advance in OUTPUT pixels — the cell's width. */
  advance: number,
  /** The em in OUTPUT pixels — the cell's height. */
  em: number,
  clip: VtGlyphClip,
): void {
  const r = glyphCellClipRect(origin, advance, em, clip)
  // `beginPath` is safe here: this renderer draws `Path2D` objects and never
  // uses the context's own current path.
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.width, r.height)
  ctx.clip()
}

/** A stable key for a coords record, so two glyphs that land on the same axis
 *  position share one `getVariation` instance instead of paying for it twice. */
function coordsKey(coords: Record<string, number>): string {
  const tags = Object.keys(coords).sort()
  let out = ''
  for (const tag of tags) out += `${tag}:${coords[tag]};`
  return out
}

/**
 * Shape the run at time `t`, giving each glyph its OWN axis position whenever
 * something has moved it there — a staggered axis TRACK, or an axis PRESET.
 *
 * This is the studio's headline capability, and it is the expensive one: a
 * travelling wave means glyph *i* sits at a different axis position from glyph
 * *i+1*, so fontkit must instance the font once per distinct coordinate set.
 * Two mitigations, both cheap:
 *
 *  - a frame where NO glyph's axes moved collapses to a SINGLE shaping (Task 6
 *    proved the collapse is exact), so the common case pays nothing. Note it is
 *    the axis motion that decides, NOT `delay === 0`: an axis preset moves the
 *    outline with the stagger off, and gating on the delay alone would return
 *    axis numbers that nothing ever shaped.
 *  - identical coordinate sets are memoised within the frame, so a `center` or
 *    `edges` order — where glyphs pair up — costs about half, and a preset with
 *    no stagger costs exactly one extra shaping for the whole run.
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
  const staggered = stagger.delay > 0 && n > 1

  // MOTION FIRST, then geometry. An axis PRESET (`./axisPresets.ts`) puts each
  // glyph at its own axis position through `transforms[i].axes`, exactly as a
  // staggered axis track does through `glyphConfig` — so the shaping below has
  // to know both before it can decide how many shapings this frame needs.
  //
  // One em for the whole run, resolved once: `vtPlacement` scales every glyph by
  // the SAME `size`, so a per-glyph em would move the letters in units the
  // geometry does not share.
  const em = vtEmSize(cfg, t)
  const resting: Record<string, number>[] = []
  const transforms: VtGlyphMotion[] = []
  for (let i = 0; i < n; i++) {
    // The glyph's resting axes: its own clock when a stagger is on, the shared
    // one otherwise. Preset deltas are added to THIS, so a preset composes with
    // an axis track instead of replacing it.
    const rest = staggered ? glyphConfig(cfg, t, i, n).axes : base.axes
    resting.push(rest)
    transforms.push(vtGlyphMotion(cfg, t, i, n, em, { axes: font.axes, resting: rest }))
  }

  // THE FAST PATH, widened (Task 4's hand-off). `delay === 0` is the DEFAULT, and
  // it used to collapse to a single shaping unconditionally — which was right
  // while only tracks could move an axis, and silently wrong the moment a preset
  // could: every axis preset would have returned numbers that nothing shaped.
  // A zero delta is never emitted, so a frame with no axis motion still takes
  // the one-shaping path and pays nothing.
  const axisMotion = transforms.some(tr => Object.keys(tr.axes).length > 0)
  const perGlyph = staggered || axisMotion
  const cache = new Map<string, TextOutlines>()
  cache.set(coordsKey(shaped.coords), shaped)

  const source: GlyphOutline[] = []
  // The coords every glyph shared, when they did share one set — so
  // `outlines.coords` reports what was actually shaped rather than the resting
  // position the presets moved off. Null once two glyphs disagree: a travelling
  // wave has no single answer, and `staggered`/`shapings` are what describe it.
  let uniform: Record<string, number> | null = shaped.coords
  if (perGlyph) {
    let firstKey: string | null = null
    uniform = null
    for (let i = 0; i < n; i++) {
      // Fully resolved absolute coords — resting position plus the preset's
      // delta, clamped to each axis's own range. Equal to what `textOutlines`
      // resolves internally, so the cache key describes the real shaping.
      const coords = vtAxisCoords(font.axes, resting[i], transforms[i]?.axes)
      const key = coordsKey(coords)
      if (i === 0) { firstKey = key; uniform = coords }
      else if (key !== firstKey) uniform = null
      let run = cache.get(key)
      if (!run) {
        run = textOutlines(font, base.text, coords)
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

  return {
    outlines: { glyphs, width: penX, unitsPerEm: upem, coords: uniform ?? shaped.coords, bbox },
    config: base,
    transforms,
    // Unchanged meaning: a TRAVELLING wave, i.e. glyphs on their own clocks. An
    // axis preset at delay 0 shapes off the resting position but every glyph
    // shares it, so it is not a wave and must not claim to be one — `shapings`
    // is what says how many distinct positions were paid for.
    staggered,
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

  // The em in output pixels, from the placement rather than re-read from the
  // config, so the cell box a mask is measured against cannot drift from the
  // geometry it masks.
  const em = place.scale * (frame.outlines.unitsPerEm || 1000)

  for (let i = 0; i < paths.length; i++) {
    const glyph = frame.outlines.glyphs[i] as GlyphOutline
    const path = paths[i] as Path2D
    const tr = frame.transforms[i] ?? IDENTITY_GLYPH_MOTION
    // The glyph's own placed origin — motion rotates and scales AROUND it, so a
    // spinning glyph spins in place rather than swinging about the canvas corner.
    const origin = glyphPlacement(glyph, place)

    ctx.save()
    ctx.globalAlpha = clamp01(tr.opacity)

    // BLUR. `ctx.filter` is part of the saved drawing state, so the `restore()`
    // at the bottom of this loop body is what stops it leaking into the next
    // glyph — and a leak is invisible until a glyph that should be sharp is not.
    // Nothing resets it by hand: a second reset site is a second place to forget
    // one.
    //
    // The `* k` is load-bearing, not decoration. A canvas filter's blur radius
    // is in DEVICE pixels and IGNORES the current transform — measured in Chrome
    // at ctm scale 0.5, 1 and 2, where `blur(4px)` grew a rect's device-pixel
    // footprint by exactly 18px in all three. `tr.blur` is in LOGICAL output
    // pixels (`presetMotion` already multiplied by the em), so without this the
    // 220px node card would blur ~5× harder than the 1024px bake of the same
    // config — trap 1 again, one layer down.
    const blurPx = Number.isFinite(tr.blur) ? Math.max(0, tr.blur) * k : 0
    // Below ~1/20 device px there is nothing to see, and setting a filter costs
    // a separate compositing pass per glyph.
    if (blurPx >= 0.05) ctx.filter = `blur(${blurPx}px)`

    // CLIP — before the transform below, deliberately. See `clipGlyphCell`.
    if (tr.clip && tr.clip.amount > 0.001) {
      clipGlyphCell(ctx, origin, glyph.advance * place.scale, em, tr.clip)
    }

    const sx = nonZero(tr.scale * (Number.isFinite(tr.scaleX) ? tr.scaleX : 1))
    const sy = nonZero(tr.scale * (Number.isFinite(tr.scaleY) ? tr.scaleY : 1))
    if (tr.dx || tr.dy || tr.rotate || sx !== 1 || sy !== 1) {
      ctx.translate(origin.x + tr.dx, origin.y + tr.dy)
      if (tr.rotate) ctx.rotate((tr.rotate * Math.PI) / 180)
      // Non-uniform, so the card-flip presets are DRAWN rather than degenerating
      // into a bare opacity ramp (Task 4 produced `scaleX`/`scaleY` and flagged
      // that nothing applied them). `scale` and `scaleX/Y` multiply: the uniform
      // one is the tracks' and the presets' shared channel, the per-axis pair is
      // the flip on top of it.
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy)
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
  tr: VtGlyphMotion,
  precision = 3,
): string | undefined {
  const sx = nonZero(tr.scale * (Number.isFinite(tr.scaleX) ? tr.scaleX : 1))
  const sy = nonZero(tr.scale * (Number.isFinite(tr.scaleY) ? tr.scaleY : 1))
  if (!tr.dx && !tr.dy && !tr.rotate && sx === 1 && sy === 1) return undefined
  const n = (v: number) => formatNumber(v, precision)
  const parts = [`translate(${n(origin.x + tr.dx)} ${n(origin.y + tr.dy)})`]
  if (tr.rotate) parts.push(`rotate(${n(tr.rotate)})`)
  // Single-argument when uniform: that is the same transform, and it keeps an
  // ordinary export readable. The two-argument form appears only for a card
  // flip, which is exactly when the axes really do differ.
  if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${n(sx)})` : `scale(${n(sx)} ${n(sy)})`)
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
  // The em in output pixels, from the PLACEMENT — same line as `drawVectorType`,
  // so the cell box a mask is measured against cannot drift between the two.
  const em = place.scale * (frame.outlines.unitsPerEm || 1000)

  const svg = outlinesToSVG(frame.outlines, {
    ...place,
    fill,
    // The stroke is an ATTRIBUTE, not outlined into geometry: a designer opening
    // this can restyle or remove it, and the path still describes the letterform
    // rather than the letterform's outer contour.
    stroke: stroked ? stroke : undefined,
    strokeWidth: stroked ? strokeWidth : undefined,
    fillRule: 'nonzero',
    opacity: (_g, i) => clamp01((frame.transforms[i] ?? IDENTITY_GLYPH_MOTION).opacity),
    // BLUR. `stdDeviation` is in USER UNITS and the viewBox below is 1:1 with
    // the rendered size, so it is the same number of output pixels the canvas
    // blurs by — the canvas multiplies by `pixelRatio` because ITS radius is in
    // device pixels and ignores the CTM; an SVG has no device-pixel step to
    // compensate for. No factor of two: see `blurRadiusToStdDeviation`.
    blur: (_g, i) => blurRadiusToStdDeviation((frame.transforms[i] ?? IDENTITY_GLYPH_MOTION).blur),
    // CLIP. Identical rect to the canvas's — literally the same function — and
    // it lands on a wrapper `<g>` with no transform, so the glyph's own
    // `transform` slides it THROUGH a stationary window.
    clip: (glyph, i) => {
      const tr = frame.transforms[i] ?? IDENTITY_GLYPH_MOTION
      if (!tr.clip || tr.clip.amount <= 0.001) return null
      return glyphCellClipRect(glyphPlacement(glyph, place), glyph.advance * place.scale, em, tr.clip)
    },
    attrs: (glyph, i) => {
      const tr = frame.transforms[i] ?? IDENTITY_GLYPH_MOTION
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
