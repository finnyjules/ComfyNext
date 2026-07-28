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
import type { Affine, Transform2D, VectorPaint, VectorRect } from '~/lib/vector/svg'
import { formatNumber, multiplyAffine } from '~/lib/vector/svg'
import { fillIsShader, paintPrimaryColor } from '~/lib/spacetype/fillTile'
import { isFill, type Paint } from '~/lib/compositor/paint'
import { paintIsVector, paintToVectorPaint } from '~/lib/paint/toVector'
import {
  OBJECT_SHADER_FIELD_PX,
  hasPaint,
  resolvePaint,
  type ShaderFieldFrameCtx,
} from '~/lib/paint/resolve'
import { withFieldFrame, type FieldRequest } from '~/lib/shaderfill/field'
import type { VectorTypeConfig, VtFillAnchor } from './config'
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
  CELL_DESCENT,
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
  /**
   * How many of this frame's shader fields `withFieldFrame` had to FREEZE at
   * `t = 0` because the frame asked for more live fields than
   * `LIVE_FIELD_CEILING` allows.
   *
   * Reported rather than swallowed for the same reason Space Type and Shape
   * Studio report theirs: a silently truncated field reads to a user as "my
   * shader stopped working", and there is nothing in the picture that says
   * otherwise. `drawVectorType` sets this from the span it opens; the pure
   * geometry path (`vectorTypeFrame`) opens no span and always reports 0,
   * because no field decision was made there at all.
   *
   * Vector Type carries exactly ONE paint today, so `vtFieldRequests` emits at
   * most one request and this is 0 by construction — it is wired anyway because
   * the moment a second paint lands (a `Paint`-typed stroke, per-glyph fills)
   * the ceiling becomes reachable, and a host that only starts counting once it
   * can overflow starts counting one release too late.
   */
  frozenFields: number
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
    // No `withFieldFrame` span is opened here — this function resolves GEOMETRY,
    // not paint. `drawVectorType` overwrites this with its span's real count.
    frozenFields: 0,
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

// ── Where a fill is sampled: the three anchors ──────────────────────────────
//
// Space Type has two anchors (`object | frame`) and type needs a middle term. A
// gradient across a WORD and a gradient across each LETTER are completely
// different treatments, and neither existing anchor can say the first one.
//
// All three are expressed as a box in OUTPUT (logical) pixels plus that box's
// CENTRE, because `resolvePaint` builds its gradients and pattern matrices
// CENTRED on the origin (`lib/paint/resolve.ts`'s header; the other convention
// in this codebase — `paintTileBox`'s corner origin — is documented at
// `lib/compositor/paint.ts:44-48`, and the two are deliberately NOT harmonised).
// So `w`/`h` are what the resolver is asked for, and `cx`/`cy` are where the
// drawing transform has to be for that centred geometry to land on the right
// pixels.

/** A fill's sampling box in OUTPUT pixels, with the centre the resolver's
 *  centred-origin geometry is built around. */
export interface VtPaintBox { cx: number; cy: number; w: number; h: number }

/** Never-degenerate, order-independent: a box built from two opposite corners in
 *  either order. `1e-3` matches `resolveFill`/`resolveShaderFill`'s own floor, so
 *  a zero-extent box (an empty run, a hairline glyph) cannot make the pattern
 *  matrix singular. */
function paintBoxFrom(ax: number, ay: number, bx: number, by: number): VtPaintBox {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by)
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(x1 - x0, 1e-3), h: Math.max(y1 - y0, 1e-3) }
}

/**
 * `glyph` — ONE letter's own box, so each letter carries its own copy of the fill.
 *
 * The box is the glyph's INK bounds, not its cell: that is what SVG's
 * `gradientUnits="objectBoundingBox"` means (Task 4 emits exactly that for this
 * anchor, and a canvas/SVG mismatch here would be invisible — both would still
 * show a gradient on the letter). It is also the more useful of the two: an ink
 * box gives every letter the FULL ramp over its own extent, where a cell box
 * would give a vertical gradient the same band on every letter and collapse the
 * visible difference from `word`.
 *
 * A glyph with no ink (a space) has no bounding box to speak of, so it falls back
 * to its CELL — the same box `glyphCellClipRect` masks against.
 */
export function vtGlyphPaintBox(
  glyph: GlyphOutline,
  place: Required<Transform2D>,
  /** The em in OUTPUT pixels — only used for the no-ink fallback. */
  em: number,
): VtPaintBox {
  const origin = glyphPlacement(glyph, place)
  const s = place.scale
  // y is FLIPPED by the placement, so the source's MAX y is the output's TOP.
  const fy = place.flipY ? -s : s
  const b = glyph.bbox
  const inked = glyph.commands.length > 0 && Number.isFinite(b.minX) && Number.isFinite(b.minY)
  if (!inked) {
    const y1 = origin.y + em * CELL_DESCENT
    return paintBoxFrom(origin.x, y1 - em, origin.x + glyph.advance * s, y1)
  }
  return paintBoxFrom(origin.x + b.minX * s, origin.y + b.minY * fy, origin.x + b.maxX * s, origin.y + b.maxY * fy)
}

/**
 * `word` — the RUN's ink box, so one fill spans the whole word and the letters
 * are windows onto it. Exactly the glyph box one level up: the same ink-bounds
 * rule applied to `outlines.bbox`, which is the run's bounds in font units with
 * the pen already folded in.
 *
 * An empty run (no text, or nothing but spaces) has no ink, so it falls back to
 * the frame box rather than to a sliver at the origin.
 */
export function vtRunPaintBox(
  outlines: TextOutlines,
  place: Required<Transform2D>,
  opts: VtBoxOptions,
): VtPaintBox {
  const b = outlines.bbox
  const s = place.scale
  const fy = place.flipY ? -s : s
  if (!Number.isFinite(b.minX) || (b.maxX === b.minX && b.maxY === b.minY)) return vtFramePaintBox(opts)
  return paintBoxFrom(place.x + b.minX * s, place.y + b.minY * fy, place.x + b.maxX * s, place.y + b.maxY * fy)
}

/** `frame` — the whole output box, so the type moves over a fill pinned to the
 *  canvas. Logical units, not device: the drawing transform already carries
 *  `pixelRatio`, so a 220px card and a 1024px bake sample the same composition. */
export function vtFramePaintBox(opts: VtBoxOptions): VtPaintBox {
  return {
    cx: opts.width / 2,
    cy: opts.height / 2,
    w: Math.max(opts.width, 1e-3),
    h: Math.max(opts.height, 1e-3),
  }
}

/** The anchor a config actually renders with. `frame.config` can be a raw blob
 *  (`applyMotion` clones whatever it is handed — see `cloneConfig`'s doc), so an
 *  absent or bogus value must land on `glyph`, the pre-anchor behaviour, rather
 *  than defaulting into one of the two new sampling spaces. */
export function vtFillAnchor(cfg: VectorTypeConfig): VtFillAnchor {
  const a = cfg.fillAnchor
  return a === 'word' || a === 'frame' ? a : 'glyph'
}

/** A paint that resolves to a plain CSS colour needs none of the anchoring
 *  machinery — no box, no paint-space matrix, no per-glyph `Path2D`. This is the
 *  DEFAULT config (`solid`) and every legacy string fill, so it is the path
 *  almost every frame in the product takes. */
function flatPaint(paint: Paint): string | null {
  if (typeof paint === 'string') return paint
  if (isFill(paint) && paint.type === 'solid') return paint.a
  return null
}

/**
 * The shader field this config's fill needs, sized EXACTLY the way
 * `resolveShaderFill` sizes it at paint time — frame-anchored fields at the
 * frame's own size, object-anchored ones at the fixed `OBJECT_SHADER_FIELD_PX`.
 * The two must agree or `beginFieldFrame` budgets a key the resolver never asks
 * for and the fill silently freezes at t=0; see `OBJECT_SHADER_FIELD_PX`'s doc
 * for the version of that bug that already shipped once.
 *
 * Vector Type carries exactly ONE paint, so this returns 0 or 1 requests — but it
 * still has to open its own `withFieldFrame` span, because the span is what makes
 * a field LIVE at all. Without one every field renders frozen at t=0.
 */
function vtFieldRequests(
  paint: Paint,
  /** DEVICE pixels — the frame `field.base` is captured in. */
  W: number,
  H: number,
  t: number,
  fps: number,
  bake: boolean,
): FieldRequest[] {
  if (!isFill(paint) || !fillIsShader(paint)) return []
  const frameAnchored = paint.shader.anchor === 'frame'
  return [{
    spec: paint.shader,
    w: frameAnchored ? Math.max(1, Math.round(W)) : OBJECT_SHADER_FIELD_PX,
    h: frameAnchored ? Math.max(1, Math.round(H)) : OBJECT_SHADER_FIELD_PX,
    t,
    fps,
    bake,
  }]
}

export interface VtDrawOptions extends VtBoxOptions {
  /** Painted before the glyphs. `null`/omitted leaves the canvas transparent. */
  background?: string | null
  /** True for a final export/bake. Opts shader-fill fields out of the 512px live
   *  preview clamp AND out of `LIVE_FIELD_CEILING`, exactly as `paintLayerStack`'s
   *  own `bake` flag does — same function, same time, different resolution, which
   *  is what keeps a bake from drifting from the preview it was made in. Default
   *  `false` is byte-identical to the live path. */
  bake?: boolean
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
  // The frame's own base transform, captured in DEVICE pixels while the context
  // is still identity. This is what a frame-anchored SHADER field is positioned
  // against: `resolveShaderFill` composes `CTM⁻¹ · base`, which cancels whatever
  // the fill-time transform happens to be, so the field lands on the device
  // canvas 1:1 regardless of which of the three anchors is drawing — and a 2×
  // bake asks for (and gets) a 2× field instead of a stretched 1× one.
  const deviceBase = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  ctx.clearRect(0, 0, W, H)
  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, W, H)
  }
  ctx.setTransform(k, 0, 0, k, 0, 0)

  const frame = vectorTypeFrame(font, cfg, t)
  const place = vtPlacement(frame, opts)
  const paths = outlinesToPath2D(frame.outlines, place)
  const { stroke, strokeWidth } = frame.config
  // A raw blob can reach here — `applyMotion` clones whatever it is handed — and a
  // config with no `fill` at all must still paint SOMETHING: an invisible word is a
  // worse failure than a wrong colour, and this is the same `'#ffffff'` the bridge
  // this replaces fell back to.
  const fill: Paint = frame.config.fill ?? '#ffffff'
  const anchor = vtFillAnchor(frame.config)

  // The em in output pixels, from the placement rather than re-read from the
  // config, so the cell box a mask is measured against cannot drift from the
  // geometry it masks.
  const em = place.scale * (frame.outlines.unitsPerEm || 1000)

  // ── THE FILL ────────────────────────────────────────────────────────────────
  // `config.fill` is a `Paint` (Task 2) and `ctx.fillStyle` SILENTLY IGNORES a
  // non-string assignment, so this goes through `lib/paint/resolve` — the SAME
  // resolver the Compositor paints with, extracted in Task 1 rather than copied.
  //
  // `flat` is the fast path and the common one: a `solid` fill (the default) and
  // every lifted legacy string resolve to a plain CSS colour, which needs none of
  // the paint-space machinery below.
  const flat = flatPaint(fill)
  const paints = hasPaint(fill)

  // This host's OWN shader-fill frame state. Vector Type is a second field host,
  // not a guest in the Compositor's: it opens its own `withFieldFrame` span below
  // (Task 1's hand-off #4 — a shader fill painted outside any span works, because
  // token 0 skips the isolation check, but every field freezes at t=0), and it
  // threads this struct into every `resolvePaint` call rather than reaching for a
  // module global. `fps` comes from the config's own clock so the field quantises
  // its time the same way the motion does.
  const field: ShaderFieldFrameCtx = {
    frameW: W,
    frameH: H,
    t,
    fps: frame.config.motion?.fps ?? 30,
    base: deviceBase,
    bake: !!opts.bake,
    token: 0,
  }
  const requests = paints && !flat
    ? vtFieldRequests(fill, W, H, t, field.fps, field.bake)
    : []

  return withFieldFrame(requests, (frozenCount, token) => {
    // `resolveShaderFill` reads the token from here to pass into every
    // `resolveField` call, the same way it reads `t`/`fps`/`bake`.
    field.token = token
    // Surfaced, never swallowed — see `VtFrame.frozenFields`. The studio surface
    // turns a non-zero count into a visible hint; a host that drops it on the
    // floor is a host whose shader silently stops moving.
    frame.frozenFields = frozenCount
    drawGlyphRun()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return frame
  })

  /**
   * The glyph loop, in a closure only so the `withFieldFrame` span above can wrap
   * it without re-indenting 90 lines of unrelated motion code.
   *
   * THE ANCHORS, mechanically. Each anchor picks a PAINT SPACE — a matrix `pm` —
   * and the fill is resolved and drawn with the context transform set to it:
   *
   *   glyph — `pm` is the glyph's own CTM (motion included) translated to the
   *           glyph's ink centre, so the fill rides the letter: a spinning letter
   *           spins its gradient with it.
   *   word  — `pm` is the frame's base transform translated to the RUN's ink
   *           centre. It does not depend on `i` at all, so one fill spans the
   *           whole word and the letters are windows onto it — a letter that
   *           moves slides across a fill that stays where the word is.
   *   frame — the same, but the box is the whole output box, so the type moves
   *           over a fill pinned to the canvas.
   *
   * The glyph's path is in the glyph's own CTM space, so it is pre-multiplied by
   * `pm⁻¹ · CTM` before filling: the GEOMETRY still lands exactly where the motion
   * put it, while the PAINT is anchored to `pm`. For `glyph` that product is a
   * bare translate; for `word`/`frame` it is the full cancellation of the glyph's
   * own motion, which is what makes those two anchors stand still.
   */
  function drawGlyphRun(): void {
    // Hoisted for `word` and `frame`: their paint space and their resolved style
    // are the same for every letter, so the tile/gradient/field is built ONCE for
    // the run instead of once per glyph.
    let runPm: DOMMatrix | null = null
    let runStyle: string | CanvasGradient | CanvasPattern | null = null
    if (paints && !flat && anchor !== 'glyph') {
      const box = anchor === 'frame' ? vtFramePaintBox(opts) : vtRunPaintBox(frame.outlines, place, opts)
      ctx.save()
      ctx.translate(box.cx, box.cy)
      runPm = ctx.getTransform()
      runStyle = resolvePaint(ctx, fill, { w: box.w, h: box.h }, field)
      ctx.restore()
    }

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

      const advance = glyph.advance * place.scale
      // CLIP — before the transform below, deliberately. See `clipGlyphCell`.
      if (tr.clip && tr.clip.amount > 0.001) {
        clipGlyphCell(ctx, origin, advance, em, tr.clip)
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
        //
        // THE PIVOT IS NOT THE ORIGIN. The origin is the glyph's LEFT edge on the
        // baseline. Vertically that is exactly right — type scales about its
        // baseline, which is why `card-flip-v` always read correctly. Horizontally
        // it pins each letter's left edge, so at `scaleX 0.43` the letters narrow
        // by 57 % while the word narrows by 7 %: six thin letters with wide gaps,
        // not six cards turning in place. So the horizontal pivot is the glyph
        // CELL's centre and the vertical one stays on the baseline.
        //
        // Rotation is deliberately left OUTSIDE this, still turning about the
        // origin: it was not the reported defect, `spin`/`sway`/`rock` are
        // verified against it, and moving two pivots at once would make any
        // regression impossible to attribute.
        if (sx !== 1 || sy !== 1) {
          const hx = advance / 2
          ctx.translate(hx, 0)
          ctx.scale(sx, sy)
          ctx.translate(-hx, 0)
        }
        ctx.translate(-origin.x, -origin.y)
      }
      // nonzero, always: glyph counters (the hole in an 'o') depend on it.
      if (paints) {
        if (flat !== null) {
          ctx.fillStyle = flat
          ctx.fill(path, 'nonzero')
        } else {
          // The glyph's own CTM, motion already applied above.
          const gm = ctx.getTransform()
          const box = runPm ? null : vtGlyphPaintBox(glyph, place, em)
          const pm = runPm ?? gm.translate(box!.cx, box!.cy)
          // Pull the path back into the paint space so the paint is anchored to
          // `pm` while the glyph still draws where the motion put it.
          const local = new Path2D()
          local.addPath(path, pm.inverse().multiply(gm))
          ctx.save()
          ctx.setTransform(pm)
          ctx.fillStyle = runStyle ?? resolvePaint(ctx, fill, { w: box!.w, h: box!.h }, field)
          ctx.fill(local, 'nonzero')
          ctx.restore()
        }
      }
      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeStyle = stroke
        ctx.stroke(path)
      }
      ctx.restore()
    }
  }
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
 *   translate(origin + d) · rotate · translate(adv/2, 0) · scale
 *                         · translate(-adv/2, 0) · translate(-origin)
 *
 * An SVG transform list composes left-to-right the same way successive `ctx`
 * operations do, and SVG's `rotate(deg)` turns the same direction as
 * `ctx.rotate(rad)` because both spaces are y-down here (the flip is already
 * baked into the coordinates by `transformCommands`). So the two are the same
 * transform written twice, not two transforms that happen to agree.
 *
 * The pair of `adv/2` translates around the scale is the horizontal pivot — see
 * the long note at the canvas site for why it is the cell centre and not the
 * origin. It is written here in the same shape rather than folded into the
 * outer translates on purpose: a reader comparing the two functions has to be
 * able to see that they are the same list.
 *
 * Returns `undefined` for identity so an unanimated export carries no attribute.
 */
function glyphSvgTransform(
  origin: { x: number; y: number },
  advance: number,
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
  if (sx !== 1 || sy !== 1) {
    const hx = Number.isFinite(advance) ? advance / 2 : 0
    parts.push(`translate(${n(hx)} 0)`)
    parts.push(sx === sy ? `scale(${n(sx)})` : `scale(${n(sx)} ${n(sy)})`)
    parts.push(`translate(${n(-hx)} 0)`)
  }
  parts.push(`translate(${n(-origin.x)} ${n(-origin.y)})`)
  return parts.join(' ')
}

/**
 * The SAME transform as `glyphSvgTransform`, as a matrix.
 *
 * A run- or frame-anchored paint server has to be pinned in document space, and
 * the only thing that does that is a `gradientTransform` holding the INVERSE of
 * the glyph's own transform (`VectorGradient.units` says why the untransformed
 * wrapper `<g>` cannot). That needs the transform as numbers, not as a string.
 *
 * Written as the same sequence of parts, in the same order, from the same
 * inputs, ROUNDED THE SAME WAY — so the matrix is the exact transform the
 * `transform` attribute spells out, not an approximation of it. A unit test
 * parses the string and composes it to hold the two together; two hand-written
 * compositions of the same list is precisely the drift this file exists to
 * prevent.
 *
 * `null` for identity, matching `glyphSvgTransform`'s `undefined`.
 */
function glyphSvgMatrix(
  origin: { x: number; y: number },
  advance: number,
  tr: VtGlyphMotion,
  precision = 3,
): Affine | null {
  const sx = nonZero(tr.scale * (Number.isFinite(tr.scaleX) ? tr.scaleX : 1))
  const sy = nonZero(tr.scale * (Number.isFinite(tr.scaleY) ? tr.scaleY : 1))
  if (!tr.dx && !tr.dy && !tr.rotate && sx === 1 && sy === 1) return null
  // Through the string formatter and back, so the matrix carries the numbers the
  // file carries rather than the full-precision ones behind them.
  const q = (v: number) => Number.parseFloat(formatNumber(v, precision))
  const T = (x: number, y: number): Affine => [1, 0, 0, 1, x, y]
  let m: Affine = T(q(origin.x + tr.dx), q(origin.y + tr.dy))
  if (tr.rotate) {
    const rad = (q(tr.rotate) * Math.PI) / 180
    const c = Math.cos(rad), s = Math.sin(rad)
    m = multiplyAffine(m, [c, s, -s, c, 0, 0])
  }
  if (sx !== 1 || sy !== 1) {
    const hx = q(Number.isFinite(advance) ? advance / 2 : 0)
    m = multiplyAffine(m, T(hx, 0))
    m = multiplyAffine(m, [q(sx), 0, 0, q(sy), 0, 0])
    m = multiplyAffine(m, T(-hx, 0))
  }
  return multiplyAffine(m, T(q(-origin.x), q(-origin.y)))
}

/** A `VtPaintBox` (centre + extent, the canvas resolver's convention) as a
 *  document-space rect, which is what a `userSpaceOnUse` paint server spans. */
function paintBoxRect(box: VtPaintBox): VectorRect {
  return { x: box.cx - box.w / 2, y: box.cy - box.h / 2, width: box.w, height: box.h }
}

// ── TIER 3: the honest raster embed ─────────────────────────────────────────
//
// `ombre`, `noise` and `shader` have no vector form and never will. `ombre` and
// `noise` are per-pixel stochastic dithers — there is no SVG primitive for "this
// pixel, by hash" — and a `shader` is a WebGL2 fragment program, pixels by
// construction with no geometry to recover. The user chose all nine fill types
// knowing three of them are like this; the deal is that the export is CORRECT and
// DECLARED, not that it is quietly replaced by a flat colour (which is what the
// Compositor's writer does, and what this replaces).
//
// So they come out as `<pattern><image href="data:image/png;base64,…">`. Real,
// working, self-contained SVG — simply raster. Task 7 is what tells the user.
//
// THE SPINE STAYS PURE (plan trap 3). `lib/vector/svg.ts` is documented "no DOM,
// no canvas, no fetch", which is the property that makes it reusable — Shape
// Studio is its intended second consumer. A data URL needs a canvas, so the
// encoding happens HERE and the finished string is passed in;
// `VectorPattern.image` is a string the writer was handed, never one it built.

/** Above this, a supersampled embed costs more file than it can possibly show.
 *  It caps the SUPERSAMPLING only — never the 1:1 floor; see `rasterScaleFor`. */
const RASTER_MAX_PX = 4096

/**
 * Pixels per document unit for this export's embeds.
 *
 * THE FLOOR IS 1, ALWAYS. The point of this whole function is the thing it
 * cannot do: return less than export resolution. `resolveField` clamps a LIVE
 * request to 512 px, which is right for a 30 fps preview and catastrophic for an
 * export — a 1600-unit-wide shader fill would embed a 512 px bitmap stretched
 * over it. The clamp is opted out of with `bake: true` (see `rasteriseForExport`),
 * and the size asked for is derived from the document, so nothing here can quietly
 * re-introduce it. `RASTER_MAX_PX` only trims SUPERSAMPLING on a huge document.
 *
 * THE DEFAULT IS A MEASUREMENT, not a taste. A shader field is a CONTINUOUS
 * function being sampled, so supersampling it is strictly better: measured against
 * the canvas at 1:1, a 2× embed of three different effects diffs 0.0000 % of core
 * ink pixels (worst 0) — free crispness for a designer who scales the artwork up.
 * `ombre` and `noise` are the opposite: their raster grid IS the artwork, a
 * per-pixel hash, and supersampling it produces a genuinely FINER grain — 56–91 %
 * of core pixels differ, with the 8×8 block mean off by 10–17/255, i.e. a visibly
 * different fill rather than a sharper one. So a dither embeds at exactly 1:1 and
 * a field at 2×.
 *
 * An EXPLICIT `rasterScale` still wins for either — a caller that wants a 4×
 * dither is asking for a finer grain deliberately, and this is not the place to
 * argue.
 */
function rasterScaleFor(opts: VtSvgOptions, boxes: readonly (VtPaintBox | null)[], paint: Paint): number {
  const sampled = isFill(paint) && fillIsShader(paint)
  const asked = Number.isFinite(opts.rasterScale as number) ? (opts.rasterScale as number) : (sampled ? 2 : 1)
  const s = Math.max(1, Math.min(4, asked))
  let side = Math.max(opts.width, opts.height, 1)
  for (const b of boxes) if (b) side = Math.max(side, b.w, b.h)
  return Math.min(s, Math.max(1, RASTER_MAX_PX / side))
}

/**
 * One paint box → a PNG data URL, by drawing the SAME resolver the canvas paints
 * with over the SAME box. Not a second rendering of the fill: `resolvePaint` is
 * `lib/paint/resolve`'s, so what is embedded is by construction what
 * `drawVectorType` would have put on screen.
 *
 * ── THE COPY (plan trap 4) ─────────────────────────────────────────────────
 * `resolveField` hands back a canvas OWNED by its LRU cache, and its ownership
 * contract says consumers MUST NOT copy it — an earlier revision that copied
 * everywhere measured as the dominant cost in a ~4× regression, which is why the
 * contract exists at all. Filling with the resulting `CanvasPattern` copies those
 * pixels into the canvas below, and `toDataURL` copies them again.
 *
 * That is legitimate HERE AND NOWHERE ELSE. An export is one-shot: there is no
 * frame budget to blow, and an SVG cannot reference a live canvas — the pixels
 * have to become bytes in the file or there is no export. Every per-frame path
 * (`drawVectorType`, the node card, the frame source) still binds the field
 * directly through `ctx.fillStyle` and copies nothing.
 *
 * The gate is that this function is MODULE-PRIVATE and called from exactly one
 * place, `vectorTypeSVG` below. It is not exported, so it cannot be picked up by
 * a render loop; if you find yourself widening that, you are about to pay the 4×.
 */
function rasterisePaintBox(paint: Paint, box: VtPaintBox, scale: number, field: ShaderFieldFrameCtx): string | null {
  const w = Math.max(1, Math.round(box.w * scale))
  const h = Math.max(1, Math.round(box.h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const x0 = box.cx - box.w / 2
  const y0 = box.cy - box.h / 2
  // The FRAME's own base transform, in this raster's pixels — the same capture
  // `drawVectorType` makes while its context is still identity, and what a
  // FRAME-anchored shader field is positioned against (`resolveShaderFill`
  // composes `CTM⁻¹ · base`). Here the raster covers only `box`, so the frame's
  // origin sits at `-x0·scale, -y0·scale`: a frame-anchored field stays pinned to
  // the document even when the box it is being sampled through is one letter's.
  ctx.setTransform(1, 0, 0, 1, -x0 * scale, -y0 * scale)
  field.base = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  // Document units → raster pixels, then the resolver's CENTRED-origin
  // convention: exactly `drawGlyphRun`'s `translate(box.cx, box.cy)` before
  // `resolvePaint`, so the geometry the resolver builds lands on the same pixels.
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale)
  ctx.translate(box.cx, box.cy)
  ctx.fillStyle = resolvePaint(ctx, paint, { w: box.w, h: box.h }, field)
  ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h)
  return canvas.toDataURL('image/png')
}

/**
 * The embeds for one export: one data URL per paint box, index-aligned.
 *
 * Opens this export's own `withFieldFrame` span with `bake: true`, which is what
 * takes a shader fill's field off the 512 px live clamp AND out of
 * `LIVE_FIELD_CEILING` — an export has no frame budget to protect. The requests
 * come from `vtFieldRequests`, the same function `drawVectorType` uses, so the
 * key the span budgets is the key `resolveShaderFill` then asks for; deriving it
 * twice is how a field silently freezes at `t = 0`.
 *
 * Every box shares ONE span and one field: at the `glyph` anchor six letters
 * resolve the same descriptor six times and hit the field cache five of them.
 *
 * A `null` BOX (a glyph with no ink — a space, whose path is empty and whose
 * shape the writer drops) costs nothing: no canvas, no encode. A `null` RESULT
 * means there was no canvas to draw on at all (SSR, a worker, the unit test
 * environment) and the caller falls back to a flat colour, which is the
 * pre-task-6 behaviour rather than a blank fill.
 */
function rasteriseForExport(
  paint: Paint,
  boxes: readonly (VtPaintBox | null)[],
  opts: VtSvgOptions,
  t: number,
  fps: number,
): (string | null)[] {
  if (typeof document === 'undefined' || !boxes.some(Boolean)) return boxes.map(() => null)
  const scale = rasterScaleFor(opts, boxes, paint)
  // The document at embed resolution — what a frame-anchored field is asked for.
  const frameW = Math.max(1, Math.round(opts.width * scale))
  const frameH = Math.max(1, Math.round(opts.height * scale))
  const requests = vtFieldRequests(paint, frameW, frameH, t, fps, true)
  return withFieldFrame(requests, (_frozen, token) => {
    const field: ShaderFieldFrameCtx = { frameW, frameH, t, fps, base: null, bake: true, token }
    return boxes.map(box => (box ? rasterisePaintBox(paint, box, scale, field) : null))
  })
}

export interface VtSvgOptions extends VtBoxOptions {
  /** Painted as a full-bleed rect behind the glyphs, matching the canvas.
   *  `null`/omitted leaves the document transparent. */
  background?: string | null
  /** Decimal places in path data. Default 3 — sub-tenth-of-a-pixel. */
  precision?: number
  /**
   * Pixels per document unit in a TIER-3 raster embed (`ombre`, `noise`,
   * `shader` — see `rasteriseForExport`). Clamped to 1..4; the DEFAULT depends
   * on the fill and is a measurement, not a preference (see `rasterScaleFor`).
   *
   * `1` is exactly export resolution: the viewBox is 1:1 with the rendered size,
   * so one raster pixel per document unit is what a 100 % view shows. It is
   * never clamped BELOW that, which is the property that matters — the live
   * 512 px field clamp must not reach the export.
   */
  rasterScale?: number
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

  // ── THE FILL ────────────────────────────────────────────────────────────────
  // Gradients — both the multi-stop `Gradient` and the two-colour `Fill` form —
  // export as REAL paint servers, anchored the way the canvas anchors them:
  //
  //   glyph → `objectBoundingBox`, so each letter carries its own copy of the
  //           ramp over its own ink and it rides that letter's motion. SVG maps
  //           the unit square onto the glyph's bounds with the same independent
  //           x/y stretch `vtGlyphPaintBox` + the canvas resolver produce.
  //   word  → `userSpaceOnUse` over `vtRunPaintBox`, the run's ink.
  //   frame → `userSpaceOnUse` over the whole output box.
  //
  // The two user-space anchors need the glyph's own transform CANCELLED, or the
  // ramp travels with the letter and "the type moves over a fill that stays
  // put" is silently lost — every frame still looks like a gradient on a word.
  // The wrapper `<g>` that holds a clip or a filter still does NOT do this: those
  // are applied to the element carrying them, while `fill` is inherited and a
  // paint server resolves in the user space of the element actually PAINTED.
  // Measured, not assumed. The inverse matrix is what pins it.
  //
  // The four PROCEDURAL fills — `grid`, `checkerboard`, `stripes` and `qr` —
  // export as real `<pattern>` geometry, anchored the same three ways. A pattern
  // is always `userSpaceOnUse` (a tile sized as a fraction of each shape could
  // not say "square cells"), so the `glyph` anchor hands over the glyph's own
  // paint box in document units too — which is why `box` is passed on BOTH arms
  // below. That box is in the glyph's pre-motion coordinates, the same space the
  // path data is in, so the pattern rides the letter exactly as the canvas's
  // per-glyph paint space does.
  //
  // ── TIER 3, THE RASTER EMBED ────────────────────────────────────────────────
  // `ombre`, `noise` and `shader` have no vector form at any tier, so they are
  // rasterised over their own paint box and embedded as
  // `<pattern><image href="data:image/png…">` — see `rasteriseForExport`. One
  // embed for the whole run under `word`/`frame`, one PER LETTER under `glyph`
  // (each letter's box is its own, so one shared image would be the wrong
  // picture on five of six letters).
  //
  // ── WHAT STILL BRIDGES ──────────────────────────────────────────────────────
  // `paintPrimaryColor` remains as the LAST resort, and only that: it is reached
  // when there is no canvas to rasterise on at all (SSR, a worker, the unit test
  // environment) or the paint is a blob no arm recognises. In a browser all nine
  // fill types now export as a paint server, real `<pattern>` geometry, or a
  // declared raster — none of them as a silently flattened colour.
  const anchor = vtFillAnchor(frame.config)
  const runBox = anchor === 'glyph'
    ? null
    : anchor === 'frame' ? vtFramePaintBox(opts) : vtRunPaintBox(frame.outlines, place, opts)
  const runRect = runBox ? paintBoxRect(runBox) : null
  // Asked for ONCE per export, not once per glyph: `rasteriseForExport` opens a
  // single field span for all of them. `paintIsVector` answers by KIND (it passes
  // a unit box), so this is "has no vector form", not "did not get one here".
  //
  // `isFill` is the other half of the gate and it is not belt-and-braces: only a
  // `Fill` ever reaches the arm that consumes a raster, and without it an absent
  // or unrecognised `fill` — which has no vector form either — would be handed to
  // the resolver, come back as `undefined`, and embed a canvas-default BLACK
  // rectangle in place of today's white flat fallback.
  const rasterBoxes: (VtPaintBox | null)[] = !isFill(fill) || paintIsVector(fill)
    ? []
    : runBox
      ? [runBox]
      // An ink-less glyph (a space) is dropped by the writer, so it gets no box
      // and costs no encode — its paint box would be the CELL fallback anyway.
      : frame.outlines.glyphs.map(g => (g.commands.length ? vtGlyphPaintBox(g, place, em) : null))
  const rasters = rasteriseForExport(fill, rasterBoxes, opts, t, frame.config.motion?.fps ?? 30)
  const flatFill = paintPrimaryColor(fill, '#ffffff')
  const svgFill = (glyph: GlyphOutline, i: number): VectorPaint => {
    if (runRect) {
      const tr = frame.transforms[i] ?? IDENTITY_GLYPH_MOTION
      const elementTransform = glyphSvgMatrix(glyphPlacement(glyph, place), glyph.advance * place.scale, tr, precision)
      return paintToVectorPaint(fill, {
        units: 'userSpaceOnUse',
        box: runRect,
        elementTransform,
        raster: rasters[0],
      }) ?? flatFill
    }
    const box = vtGlyphPaintBox(glyph, place, em)
    return paintToVectorPaint(fill, {
      units: 'objectBoundingBox',
      aspect: box.w / box.h,
      box: paintBoxRect(box),
      raster: rasters[i],
    }) ?? flatFill
  }

  const svg = outlinesToSVG(frame.outlines, {
    ...place,
    fill: svgFill,
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
      // Same two inputs the canvas loop uses for the pivot — the placed origin
      // and the cell's own advance — so neither renderer can drift into its own
      // idea of where a glyph turns.
      const transform = glyphSvgTransform(glyphPlacement(glyph, place), glyph.advance * place.scale, tr, precision)
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
 *
 * THREE sources as of the fills work, and the third is not a nicety. A LIVE
 * shader fill (`speed !== 0`) animates on its own clock with the type standing
 * perfectly still, so without it here a shader-filled config renders exactly one
 * frame — and worse, `resolveField` returns `null` until the effect catalog has
 * landed, so that one frame is the graceful fallback (the shader's flat input
 * paint) and NOTHING ever re-renders to replace it. The self-heal in
 * `lib/shaderfill/field.ts` is explicitly "callers that re-invoke `resolveField`
 * every frame get it for free"; this is what makes Vector Type one of them.
 * Mirrors the Compositor's `hasAnimatedShaderFill`, including why `speed: 0` must
 * NOT count: a deliberately frozen field would otherwise be impossible to
 * express, and every still node on the canvas would spin a loop forever.
 */
export function vtIsAnimated(cfg: VectorTypeConfig | null | undefined): boolean {
  const tracks = cfg?.motion?.tracks
  if (Array.isArray(tracks) && tracks.length > 0) return true
  if (vtHasPreset(cfg)) return true
  const fill = cfg?.fill
  return isFill(fill) && fillIsShader(fill) && fill.shader.speed !== 0
}
