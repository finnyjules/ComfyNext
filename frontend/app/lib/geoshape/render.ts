/**
 * geoshape render orchestration — the ONE pipeline that turns a
 * `GeoShapeConfig` into `VectorShape[]`, an SVG string, or pixels on a
 * canvas.
 *
 * `renderShapes` is the pipeline every consumer (preview, bake, SVG export)
 * must go through, for the same reason `vectortype/render.ts`'s header gives:
 * three surfaces each growing their own copy of "shape -> geometry" is drift
 * that no single render can reveal.
 *
 * `baseShapePath` (Task 1) -> `arrange` (Task 3) -> `resolvePaint` (Task 5,
 * applies `invert`'s colour swap) -> `composite` (Task 4, folds the placed
 * clones and paints with the RESOLVED colours). `resolvePaint` is called here
 * rather than inside `composite` because `composite` already reads its paint
 * straight off `cfg.fill`/`cfg.stroke`/`cfg.overlapFill` — this is the one
 * seam where the config handed to it is the POST-invert config, not the raw
 * one a caller stored.
 *
 * Only the colour-swap form of `invert` is applied. A geometric knockout
 * (e.g. painting the negative space of the mark against a filled background)
 * is a different feature — `paint.ts`'s header already scopes it out for the
 * identical reason — and is left for a future task.
 */
import type { VectorShape } from '~/lib/vector/svg'
import { commandsToPathData, shapesToSVG, type SvgDocOptions } from '~/lib/vector/svg'
import { baseShapePath } from './shapes'
import { arrange } from './arrange'
import { composite } from './boolean'
import { resolvePaint } from './paint'
import type { GeoShapeConfig } from './config'
import type { Paint } from '~/lib/compositor/paint'
import { paintToVectorPaint } from '~/lib/paint/toVector'
// The COMPOSITOR canvas resolver — NOT geoshape/paint.ts's `resolvePaint` (the
// invert helper, imported above and used for `renderShapes`'s colour-swap
// step). Aliased to avoid shadowing it; see this module's two very differently
// shaped `resolvePaint`s in the geoshape Task 2 brief.
import { resolvePaint as resolvePaintCanvas, type ShaderFieldFrameCtx } from '~/lib/paint/resolve'

/**
 * A `VectorShape` that also carries the AUTHORED `Paint` (gradient/pattern/
 * image/shader), not just the solid-string fallback `.fill` every reader
 * already understands. `boolean.ts`'s `composite` is the one producer; `toSvg`
 * consumes `.paint` to emit a real paint server, and `drawToCanvas` consumes it
 * to resolve a canvas fillStyle. `.fill` stays a plain solid-or-null fallback
 * for any reader that doesn't know about `.paint`.
 */
export type GeoVectorShape = VectorShape & { paint?: Paint }

/**
 * `GeoShapeConfig` -> the final composed mark, as paintable `VectorShape[]`
 * in document space (origin-centred, same convention `composite` already
 * builds in — see `boolean.ts`'s header).
 */
export async function renderShapes(cfg: GeoShapeConfig): Promise<VectorShape[]> {
  const baseD = baseShapePath(cfg.shape, {
    sides: cfg.sides,
    starInner: cfg.starInner,
    irregularSeed: cfg.irregularSeed,
    size: cfg.size,
    roundCorners: cfg.roundCorners,
    roundRadius: cfg.roundRadius,
  })
  const placements = arrange(cfg)
  const rp = resolvePaint(cfg)
  // The post-invert config `composite` actually paints with — it reads fill/
  // stroke/overlapFill straight off whatever `cfg` it is handed, so this is
  // the one place `invert` takes effect.
  const cfg2: GeoShapeConfig = { ...cfg, fill: rp.fill, stroke: rp.stroke, overlapFill: rp.overlapFill }
  return composite(baseD, placements, cfg2)
}

/**
 * The bounding box of `shapes`' actual path geometry (document space, same
 * origin-centred convention `composite` builds in) — every command's x/y
 * args, min and max. `arrange` pushes clones out by `radius`/`spacing`/etc.,
 * so this is frequently much bigger than `size + padding*2`: that static
 * formula was `toSvg`'s old (buggy) size source and cropped the mark.
 */
export function contentBounds(shapes: VectorShape[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of shapes) {
    for (const c of s.commands) {
      const a = c.args
      for (let i = 0; i + 1 < a.length; i += 2) {
        const x = a[i]!, y = a[i + 1]!
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (!Number.isFinite(minX)) { minX = minY = -1; maxX = maxY = 1 } // empty fallback
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/**
 * `GeoShapeConfig` -> a standalone SVG document, sized to fit the ACTUAL
 * rendered geometry plus `padding` on every side.
 *
 * The old formula sized the box from `cfg.size + cfg.padding*2` alone, but
 * `arrange` pushes clones out by `radius`/`spacing`/etc., so the real
 * geometry is routinely much bigger than that static box — for
 * `DEFAULT_CONFIG` the mark was cropped by more than half. Deriving the size
 * and viewBox from `contentBounds` instead means the box always contains
 * whatever `renderShapes` actually produced, no matter which knobs pushed it
 * out.
 */
export async function toSvg(cfg: GeoShapeConfig, opts: Partial<SvgDocOptions> = {}): Promise<string> {
  const shapes = await renderShapes(cfg)
  const b = contentBounds(shapes)
  // Convert each shape's authored `paint` (gradient/pattern) into a real
  // `VectorPaint` the SVG writer can turn into a `<linearGradient>`/`<pattern>`
  // — the solid-fallback `.fill` `composite` set is only a placeholder for
  // this. `null` (image/shader with no raster handed in) keeps that fallback:
  // Task 4 supplies the raster that would let those export too.
  const box = { x: b.minX, y: b.minY, width: b.w, height: b.h }
  for (const s of shapes as GeoVectorShape[]) {
    if (s.paint && typeof s.paint !== 'string') {
      const vp = paintToVectorPaint(s.paint, { units: 'userSpaceOnUse', box })
      if (vp) s.fill = vp
    }
  }
  const pad = Math.max(0, cfg.padding) + cfg.strokeWidth / 2
  const w = b.w + pad * 2
  const h = b.h + pad * 2
  return shapesToSVG(shapes, {
    width: w,
    height: h,
    viewBox: [b.minX - pad, b.minY - pad, w, h],
    ...opts,
  })
}

/** A fallback colour for a fill `resolvePaintCanvas` cannot resolve yet (image/
 *  shader before Task 4 warms them): mid-gray reads as "there is a fill here"
 *  without claiming to be the real one. Also `resolvePaintCanvas`'s own solid
 *  arm needs no fallback — a plain string passes straight through. */
const FALLBACK_FILL = '#808080'

/**
 * A still (`t: 0`, not baking) field frame — the minimal `ShaderFieldFrameCtx`
 * a shader-fill `Paint` needs to resolve on canvas. This host has no separate
 * "frame" the way the Compositor's paintLayerStack does, so a `frame`-anchored
 * shader (`field.frameW`/`frameH`) is out of scope here — object-anchored
 * shaders (the common case, `OBJECT_SHADER_FIELD_PX`) don't read those fields
 * at all. `token: 0` is `resolveField`'s own "no span open" sentinel (see
 * `~/lib/shaderfill/field.ts`), so a shader fill here reads the current/frozen
 * field rather than erroring — exactly the graceful image/shader fallback
 * this task's brief calls for.
 */
const STILL_FIELD: ShaderFieldFrameCtx = { frameW: 1, frameH: 1, t: 0, fps: 30, base: null, bake: false, token: 0 }

/**
 * Paint `shapes` onto a 2D canvas context, fit to the `w`×`h` box.
 *
 * The shapes are origin-centred document-space geometry, but their real
 * extent depends on `arrange`'s knobs (`radius`/`spacing`/etc.), not on the
 * canvas size — a fixed `translate(w/2,h/2)` with no scale crops the mark
 * exactly like `toSvg`'s old static-size bug. Fitting `contentBounds` into
 * the box (90% margin so nothing touches the edge) keeps the preview/bake
 * replay honest for the same reason `toSvg` now derives its size from
 * bounds instead of a static formula.
 *
 * Used by both the live preview and the bake path, so there is one canvas
 * replay of this geometry, matching `toSvg`'s one SVG replay.
 *
 * Fills go through the SAME `resolvePaint` the Compositor/Vector Type use
 * (aliased `resolvePaintCanvas` here — see this module's header on the two
 * `resolvePaint`s), so gradients/patterns/solid paint for real instead of the
 * old cheap first-stop/mid-gray stand-in. Image/shader paints resolve to a
 * fallback until warmed (a later task); that degrades gracefully, it never
 * throws.
 */
export function drawToCanvas(shapes: VectorShape[], ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  const b = contentBounds(shapes)
  const margin = 0.9
  const scale = Math.min(w / (b.w || 1), h / (b.h || 1)) * margin
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(scale, scale)
  ctx.translate(-(b.minX + b.w / 2), -(b.minY + b.h / 2))
  for (const s of shapes) {
    const path = new Path2D(commandsToPathData(s.commands))
    const paint = (s as GeoVectorShape).paint ?? s.fill
    if (paint) {
      const style = resolvePaintCanvas(ctx, paint as Paint, { w: b.w, h: b.h }, STILL_FIELD)
      ctx.fillStyle = (style as any) ?? FALLBACK_FILL
      ctx.fill(path, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.strokeWidth ?? 1
      ctx.stroke(path)
    }
  }
  ctx.restore()
}
