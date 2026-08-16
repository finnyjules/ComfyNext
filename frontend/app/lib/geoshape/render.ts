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
import { isFill, isImageFill, type Paint } from '~/lib/compositor/paint'
import { paintToVectorPaint } from '~/lib/paint/toVector'
// The COMPOSITOR canvas resolver — NOT geoshape/paint.ts's `resolvePaint` (the
// invert helper, imported above and used for `renderShapes`'s colour-swap
// step). Aliased to avoid shadowing it; see this module's two very differently
// shaped `resolvePaint`s in the geoshape Task 2 brief.
import { resolvePaint as resolvePaintCanvas, OBJECT_SHADER_FIELD_PX, type ShaderFieldFrameCtx } from '~/lib/paint/resolve'
// Task 4 — image/shader warm pass. `ensureFillBitmaps` mirrors the Compositor's
// `ensureLayerImages` (useCompositorLayers.ts:596-611, which calls it directly);
// `withFieldFrame`/`resolveField` mirror `paintLayerStack`'s shader-fill pre-pass
// (useCompositorLayers.ts:1648-1681) — see `warmPaints`'s own doc below for the
// one deliberate difference (this host awaits the effect catalog first).
import { fillIsShader, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { ensureFillBitmaps } from '~/lib/paint/imageFillCache'
import { withFieldFrame, resolveField, type FieldRequest } from '~/lib/shaderfill/field'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'

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
  // this. `null` (image/shader, TIER 3 — see toVector.ts's header) means
  // `paintToVectorPaint` has no vector form to offer without a raster; the
  // block below supplies one.
  const box = { x: b.minX, y: b.minY, width: b.w, height: b.h }
  for (const s of shapes as GeoVectorShape[]) {
    if (s.paint && typeof s.paint !== 'string') {
      let vp = paintToVectorPaint(s.paint, { units: 'userSpaceOnUse', box })
      // TIER 3 embed (Task 4 Step 2): rasterize the paint over `box` on an
      // offscreen canvas — same `resolvePaintCanvas` path `drawToCanvas`/
      // `warmPaints` use, so the embedded pixels match the live preview —
      // and ask again with the raster in hand, which the image/shader arms
      // both turn into a `<pattern>`-with-`<image>` (see `rasterTile` in
      // toVector.ts). DOM-only (creates a `<canvas>`): under SSR or a
      // headless unit test (no `document`) this stays skipped and the shape
      // keeps its solid-fallback `.fill`, exactly like before this task.
      if (vp === null && typeof document !== 'undefined') {
        const raster = await rasterizePaint(s.paint, box.width, box.height)
        if (raster) vp = paintToVectorPaint(s.paint, { units: 'userSpaceOnUse', box, raster })
      }
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
 * old cheap first-stop/mid-gray stand-in. Image/shader paints resolve to
 * `FALLBACK_FILL` until their bitmap/field is warmed — this function stays
 * synchronous on purpose (it is also the bake/hit-test replay), so warming is
 * the CALLER's job: `warmPaints` below, then call this again. That degrades
 * gracefully either way; it never throws.
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

// ── Task 4: image/shader warm pass ──────────────────────────────────────────

/** Every shape's authored `Paint` — the same value `drawToCanvas` reads paint
 *  from (`.paint ?? .fill`) — for a caller (`ShapeStudioSurface`) that needs to
 *  know what to warm without re-deriving that fallback itself. */
export function shapePaints(shapes: VectorShape[]): Paint[] {
  const out: Paint[] = []
  for (const s of shapes) {
    const p = (s as GeoVectorShape).paint ?? s.fill
    if (p) out.push(p as Paint)
  }
  return out
}

/** True when `paint` is an `ImageFill` or a shader `Fill` — the two `Paint`
 *  kinds `resolvePaintCanvas`/`resolveField` can only resolve for real AFTER an
 *  async warm (`getFillBitmap`/`resolveField`'s cache is empty on the first
 *  ask). Every other `Paint` kind (solid/gradient/procedural pattern) resolves
 *  synchronously already, so it is deliberately excluded here — warming it
 *  would just be wasted work with nothing to cache. */
function isAsyncPaint(paint: Paint | undefined): boolean {
  return isImageFill(paint) || (isFill(paint) && fillIsShader(paint))
}

/** Whether ANY of `paints` needs `warmPaints` — the guard `ShapeStudioSurface`
 *  checks before paying for a second `drawToCanvas` pass; skips it entirely
 *  for a solid/gradient/pattern-only mark, which already paints for real on
 *  the first (synchronous) pass. */
export function hasAsyncPaint(paints: (Paint | undefined)[]): boolean {
  return paints.some(isAsyncPaint)
}

/**
 * Warm the image-bitmap and shader-field caches `resolvePaintCanvas`
 * (`drawToCanvas` above) and `paintToVectorPaint`'s raster arm (`toSvg` below,
 * Task 4 Step 2) both read SYNCHRONOUSLY, so a caller that repaints/rasterizes
 * after this resolves gets the real paint instead of `FALLBACK_FILL`.
 *
 * Mirrors the Compositor's own warm-then-paint split, not a new scheme:
 *  - **images** — `ensureFillBitmaps`, the same call
 *    `useCompositorLayers.ts:610`'s `ensureLayerImages` makes.
 *  - **shaders** — `withFieldFrame` + `resolveField`, the same pairing
 *    `useCompositorLayers.ts:1680`'s `paintLayerStack` makes once per painted
 *    frame (see `resolveShaderFill`'s "Shader fills on frame primitives" doc
 *    in `~/lib/paint/resolve.ts` for why a HOST must own one synchronous span
 *    rather than share `liveKeys` with another host's).
 *
 * ONE deliberate difference from the Compositor: this host has no per-frame
 * render loop of its own (`ShapeStudioSurface`'s preview is event/dirty-driven
 * — see its own doc), so unlike `paintLayerStack`'s span (which self-heals for
 * free on the NEXT frame if the shader-effect catalog is still loading), a
 * cold catalog here would leave the field frozen on its input-fill fallback
 * forever with nothing to retry it. So this ALSO awaits
 * `fetchShaderFxCatalog()` first — the same one-shot-host pattern
 * `VectorTypeSurface.vue`'s `renderFullResBlob`/`exportSvg` use for their own
 * PNG/SVG exports.
 *
 * `box` matches `resolvePaintCanvas`'s own `{ w, h }` convention and sizes a
 * FRAME-anchored shader request exactly like `useCompositorLayers.ts`'s
 * `addShaderFieldRequest` does. It plays no part in the common case though:
 * an OBJECT-anchored field (`resolveShaderFill`'s `OBJECT_SHADER_FIELD_PX`
 * arm) always renders at that fixed size regardless of `box`, and
 * `getFillBitmap` keys an image purely on `src`. A frame-anchored shader is
 * out of scope for THIS host regardless (see `STILL_FIELD`'s doc — paint time
 * always asks for a 1×1 field), so warming one at `box`'s size builds a cache
 * entry paint time never actually reads; harmless, just not load-bearing.
 */
export async function warmPaints(paints: (Paint | undefined)[], box: { w: number; h: number }): Promise<void> {
  const imgSrcs = new Set<string>()
  const shaderSpecs: ShaderSpec[] = []
  for (const p of paints) {
    if (isImageFill(p) && p.src) imgSrcs.add(p.src)
    else if (isFill(p) && fillIsShader(p)) shaderSpecs.push(p.shader)
  }
  const jobs: Promise<unknown>[] = []
  if (imgSrcs.size) jobs.push(ensureFillBitmaps([...imgSrcs]))
  if (shaderSpecs.length) {
    jobs.push(
      fetchShaderFxCatalog()
        .catch(() => { /* offline/backend down — resolveShaderFill degrades to the input fill, same as before */ })
        .then(() => {
          const requests: FieldRequest[] = shaderSpecs.map(spec => ({
            spec,
            w: spec.anchor === 'frame' ? Math.max(1, Math.round(box.w)) : OBJECT_SHADER_FIELD_PX,
            h: spec.anchor === 'frame' ? Math.max(1, Math.round(box.h)) : OBJECT_SHADER_FIELD_PX,
            t: STILL_FIELD.t, fps: STILL_FIELD.fps, bake: STILL_FIELD.bake,
          }))
          // One synchronous span for every shader this warm pass carries — see this
          // function's own doc on why that has to be true here just like it is in
          // paintLayerStack. Discards the returned canvases: this call's only job is
          // to populate resolveField's cache so the NEXT (synchronous) resolve, made
          // through STILL_FIELD outside any span (token 0 — see its doc), hits it.
          withFieldFrame(requests, (_frozenCount, token) => {
            for (const req of requests) resolveField(req, token)
          })
        }),
    )
  }
  if (jobs.length) await Promise.all(jobs)
}

/**
 * Rasterize `paint` over a `w`×`h` rect to a `data:image/png` URL — the pixel
 * source `toSvg`'s TIER 3 embed hands `paintToVectorPaint` as `raster`
 * (`~/lib/paint/toVector.ts`). Warms first (`warmPaints`) so an image/shader
 * paint isn't captured mid-`FALLBACK_FILL`, then paints through the SAME
 * `resolvePaintCanvas` path `drawToCanvas` uses, centred the same way, so the
 * embedded pixels match the live preview rather than being a second, drifting
 * rasterizer. The tile is corner-origin ([0,0]..[w,h], unclipped — same
 * convention `rasterTile`'s SVG placement assumes: the `<pattern>` IS the box,
 * and the referencing shape's own `fill-rule` clips it, not this pixel data).
 *
 * DOM-only (creates a `<canvas>`) — `toSvg` only calls this after checking
 * `document` exists, so this itself does not re-guard.
 */
async function rasterizePaint(paint: Paint, w: number, h: number): Promise<string | null> {
  await warmPaints([paint], { w, h })
  const cw = Math.max(1, Math.round(w))
  const ch = Math.max(1, Math.round(h))
  const off = document.createElement('canvas')
  off.width = cw
  off.height = ch
  const ctx = off.getContext('2d')
  if (!ctx) return null
  ctx.translate(cw / 2, ch / 2)
  const style = resolvePaintCanvas(ctx, paint, { w: cw, h: ch }, STILL_FIELD)
  ctx.fillStyle = (style as any) ?? FALLBACK_FILL
  ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
  return off.toDataURL('image/png')
}
