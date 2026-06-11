/**
 * Local "design" layers for the Compositor — text and shapes authored directly
 * in the editor, with no upstream graph node. They live on the compositor node
 * (`node.data.properties.comfynext_localLayers`) and are baked client-side into
 * a single RGBA overlay at submit time, then fed to the backend as an alpha
 * overlay (see `nodes_compositor.py`).
 *
 * Geometry is resolution-independent so the editor preview, the node thumbnail,
 * and the final bake all match exactly:
 *   - `x`, `y`      → normalized CENTER position (0..1 of canvas width/height)
 *   - sizes         → normalized to canvas WIDTH (uniform, so rotation never
 *                     shears regardless of canvas aspect)
 * One renderer (`drawLocalLayer`) draws to any 2D context at any resolution.
 */

export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'path'

// ── Motion painter indirection ───────────────────────────────────────────────
// paintLayerStack(t) needs the motion module, but motion/paint.ts imports
// drawLocalLayer from THIS file — a static import here would be a cycle.
// paint.ts registers its functions on first import; callers that pass a time
// (modal preview, bake) import '~/lib/motion/paint' and guarantee registration.
// Type-only imports are erased at runtime, so they don't create a cycle
// (evaluate.ts/types.ts don't import this file).
import type { LayerMotionState } from '~/lib/motion/evaluate'
import type { FrameMotion } from '~/lib/motion/types'

interface MotionPainter {
  motionStateFor: (layer: LocalLayer, t: number, motion: FrameMotion) => LayerMotionState | null
  drawLayerWithMotion: (
    ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number,
    maskLayer: LocalLayer | null, st: LayerMotionState, maskState: LayerMotionState | null,
  ) => void
  identityState: () => LayerMotionState
}
let _motionPainterImpl: MotionPainter | null = null
export function _registerMotionPainter(impl: MotionPainter) { _motionPainterImpl = impl }

// ── Paint (solid color or gradient) ──────────────────────────────────────────
// A fill/stroke can be a plain CSS color string, or a gradient. Gradient
// geometry is resolution-independent: it's resolved against the layer's local
// bounding box at draw time, so it scales with the shape.
export interface GradientStop { offset: number; color: string } // offset 0..1
export interface LinearGradient { type: 'linear'; angle: number; stops: GradientStop[] } // angle in degrees
export interface RadialGradient { type: 'radial'; stops: GradientStop[] }
export type Gradient = LinearGradient | RadialGradient
export type Paint = string | Gradient

export function isGradient(p: Paint | undefined): p is Gradient {
  return !!p && typeof p === 'object' && (p.type === 'linear' || p.type === 'radial')
}

// Layer effects (Figma-style). All distances normalized to canvas width, like
// every other dimension here, so they survive resize/export unchanged.
export interface DropShadowEffect {
  type: 'drop_shadow'
  color: string   // rgba/hex (alpha allowed)
  x: number       // offset X, normalized to canvas width
  y: number       // offset Y, normalized to canvas width
  blur: number    // blur radius, normalized to canvas width
  visible: boolean
}
export interface LayerBlurEffect {
  type: 'layer_blur'
  radius: number  // blur radius, normalized to canvas width
  visible: boolean
}
// Shadow cast inward from the layer's silhouette edge (Figma inner shadow).
export interface InnerShadowEffect {
  type: 'inner_shadow'
  color: string
  x: number       // offset X, normalized to canvas width
  y: number       // offset Y, normalized to canvas width
  blur: number    // blur radius, normalized to canvas width
  visible: boolean
}
// Blur what's BEHIND the layer, within its silhouette (Figma background blur).
// Previews correctly wherever the full stack is painted (paintLayerStack); a
// bake of locals alone can only blur the local backdrop below it — wired
// pixels behind it composite server-side, so they can't be pre-blurred.
export interface BackgroundBlurEffect {
  type: 'background_blur'
  radius: number  // blur radius, normalized to canvas width
  visible: boolean
}
export type LayerEffect = DropShadowEffect | LayerBlurEffect | InnerShadowEffect | BackgroundBlurEffect

// Clip mask: the layer is clipped to a rect/ellipse region in CANVAS space
// (axis-aligned, normalized like everything else). For local layers this is
// applied in the canvas and carried into the bake, so the clipped alpha is also
// the generation coverage — the seam for "mask region == inpaint region".
export interface LayerMask {
  kind: 'rect' | 'ellipse'
  x: number          // normalized center X (of width)
  y: number          // normalized center Y (of height)
  w: number          // normalized to canvas width
  h: number          // normalized to canvas width
}

interface LayerCommon {
  id: string
  kind: LocalLayerKind
  x: number          // normalized center X (0..1 of width)
  y: number          // normalized center Y (0..1 of height)
  rotation: number   // degrees
  opacity: number    // 0..1
  visible?: boolean  // false = hidden everywhere (render, bake, export); undefined = visible
  locked?: boolean   // true = not selectable/editable from the canvas (panel still can)
  blend?: string     // blend mode vs layers below ('normal' default; same names as wired)
  groupId?: string   // layers sharing a groupId select/move/transform together
  groupName?: string // display name for the group (mirrored on every member)
  effects?: LayerEffect[] // drop shadow etc. — applied at render time
  mask?: LayerMask        // crop to a rect/ellipse region — applied at render time
  maskedById?: string     // clipped by another layer's alpha silhouette (Figma mask)
  /** Motion (Kinetic Slates): timing + presets evaluated by app/lib/motion.
   *  Absent ⇒ the layer is static and always visible. */
  animation?: import('~/lib/motion/types').LayerAnimation
}

/** True when a layer is hidden (visible === false; undefined means visible). */
export function layerHidden(l: { visible?: boolean } | null | undefined): boolean {
  return l?.visible === false
}

export interface TextLayer extends LayerCommon {
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight: number     // 100..900 (was 400 | 700 — old values stay valid)
  fontSize: number       // normalized to canvas width
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number     // multiplier
  strokeColor: string
  strokeWidth: number    // normalized to canvas width (0 = no outline)
  boxW?: number          // optional text-box width (normalized to canvas width);
                         // set => words auto-wrap to fit, unset => explicit \n only
}

export interface RectLayer extends LayerCommon {
  kind: 'rect'
  w: number; h: number    // normalized to canvas width
  fill: Paint             // '' / 'none' = no fill; or a gradient
  stroke: string
  strokeWidth: number     // normalized to canvas width
  radius: number          // normalized to canvas width
}

export interface EllipseLayer extends LayerCommon {
  kind: 'ellipse'
  w: number; h: number
  fill: Paint
  stroke: string
  strokeWidth: number
}

/**
 * Bezier vector path — the core of the vector editor. Geometry is stored as an
 * SVG path string `d` whose coordinates are in LOCAL units (1 unit = canvas
 * width) and CENTERED on the path's bounding-box midpoint, so the layer's x/y +
 * rotation transform behaves exactly like every other layer. `scale` is a
 * uniform multiplier the resize handle drives; `bbox` is the un-scaled local
 * extent (cached on import/edit) used for selection boxes and hit-testing.
 */
export interface PathLayer extends LayerCommon {
  kind: 'path'
  d: string               // SVG path data, local units, centered on (0,0)
  bbox: { w: number; h: number } // un-scaled local extent (width-fraction units)
  scale: number           // uniform size multiplier
  fill: Paint             // '' / 'none' = no fill; or a gradient
  fillRule: 'nonzero' | 'evenodd'
  stroke: string
  strokeWidth: number     // local units at scale=1 (scales with the shape)
}

export interface LineLayer extends LayerCommon {
  kind: 'line'
  w: number               // length, normalized to canvas width
  stroke: string
  strokeWidth: number
}

export interface ImageLayer extends LayerCommon {
  kind: 'image'
  filename: string        // uploaded image in ComfyUI's input dir
  w: number; h: number    // normalized to canvas width (aspect preserved on drop)
}

export type LocalLayer = TextLayer | RectLayer | EllipseLayer | LineLayer | ImageLayer | PathLayer

let _idSeq = 0
function newId(): string {
  _idSeq += 1
  return `ll-${Date.now().toString(36)}-${_idSeq}`
}

// ── Ideogram Layerize import ─────────────────────────────────────────────────
// Convert the layers_json emitted by LayerizeGraphicNode (Ideogram Layerize)
// into Frame text layers. Ideogram reports a `resolution` (often different
// from the input size — it re-renders) and text containers whose item boxes
// are top-left px rects in that resolution space; our layers are normalized
// center coords, so the math here is the whole conversion. Schema sample:
//   { data: [{ resolution: "1152x864", text_containers: [{ items: [{
//       x, y, width, height, angle, alignment, font_file, font_size,
//       line_height, spans: [{ color, text }] }] }] }] }
export interface IdeogramImport { width: number; height: number; textLayers: TextLayer[] }

export function parseIdeogramLayers(json: string): IdeogramImport | null {
  let root: any
  try { root = JSON.parse(json) } catch { return null }
  const d = root?.data?.[0]
  if (!d) return null
  const [W, H] = String(d.resolution || '').split('x').map(Number)
  if (!W || !H) return null
  const textLayers: TextLayer[] = []
  for (const container of d.text_containers ?? []) {
    for (const item of container.items ?? []) {
      const spans: any[] = item.spans ?? []
      const text = spans.map((s) => s?.text ?? '').join('')
      if (!text.trim()) continue
      // 'Montserrat-Medium.ttf' → 'Montserrat'; camel-case splits get spaces.
      const file = String(item.font_file || '')
      const family = file.replace(/\.(ttf|otf)$/i, '').split('-')[0]
        .replace(/([a-z])([A-Z])/g, '$1 $2').trim()
      textLayers.push(createTextLayer({
        x: ((item.x ?? 0) + (item.width ?? 0) / 2) / W,
        y: ((item.y ?? 0) + (item.height ?? 0) / 2) / H,
        rotation: Number(item.angle) || 0,
        text,
        fontFamily: family || 'Inter',
        fontWeight: /bold|black|heavy|700|800|900/i.test(file) ? 700 : 400,
        fontSize: (Number(item.font_size) || 32) / W,
        color: spans[0]?.color || '#ffffff',
        align: (['left', 'center', 'right'] as const).includes(item.alignment) ? item.alignment : 'center',
        lineHeight: typeof item.line_height === 'number' && item.line_height > 0 ? item.line_height : 1.2,
      }))
    }
  }
  return { width: W, height: H, textLayers }
}

// ── Factories ───────────────────────────────────────────────────────────────

export function createTextLayer(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    id: newId(), kind: 'text',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    text: 'Double-click to edit',
    fontFamily: 'Inter', fontWeight: 700,
    fontSize: 0.08, color: '#ffffff', align: 'center', lineHeight: 1.2,
    strokeColor: '#000000', strokeWidth: 0,
    ...partial,
  }
}

export function createRectLayer(partial: Partial<RectLayer> = {}): RectLayer {
  return {
    id: newId(), kind: 'rect',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.3, h: 0.18, fill: '#3b82f6', stroke: '', strokeWidth: 0, radius: 0.02,
    ...partial,
  }
}

export function createEllipseLayer(partial: Partial<EllipseLayer> = {}): EllipseLayer {
  return {
    id: newId(), kind: 'ellipse',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, fill: '#ef4444', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

export function createLineLayer(partial: Partial<LineLayer> = {}): LineLayer {
  return {
    id: newId(), kind: 'line',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.4, stroke: '#ffffff', strokeWidth: 0.01,
    ...partial,
  }
}

export function createPathLayer(partial: Partial<PathLayer> = {}): PathLayer {
  return {
    id: newId(), kind: 'path',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    d: '', bbox: { w: 0.3, h: 0.3 }, scale: 1,
    fill: '#3b82f6', fillRule: 'nonzero', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

/**
 * Convert a primitive shape (rect / ellipse / line) to an equivalent PathLayer
 * so it can take part in boolean ops, node editing, etc. Geometry is expressed
 * in the path local frame (centered on origin, units = canvas width), matching
 * the shape's own x/y/rotation. Returns the layer unchanged if already a path,
 * or null for kinds without a closed outline to convert (text / image).
 */
export function shapeToPathLayer(layer: LocalLayer): PathLayer | null {
  if (layer.kind === 'path') return layer
  const f = (v: number) => +v.toFixed(5)
  if (layer.kind === 'rect') {
    const { w, h } = layer
    const r = Math.max(0, Math.min(layer.radius, Math.min(w, h) / 2))
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2
    const d = r <= 0
      ? `M ${f(x0)} ${f(y0)} L ${f(x1)} ${f(y0)} L ${f(x1)} ${f(y1)} L ${f(x0)} ${f(y1)} Z`
      : `M ${f(x0 + r)} ${f(y0)} L ${f(x1 - r)} ${f(y0)} Q ${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)}` +
        ` L ${f(x1)} ${f(y1 - r)} Q ${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)}` +
        ` L ${f(x0 + r)} ${f(y1)} Q ${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)}` +
        ` L ${f(x0)} ${f(y0 + r)} Q ${f(x0)} ${f(y0)} ${f(x0 + r)} ${f(y0)} Z`
    return createPathLayer({
      d, bbox: { w, h }, scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation,
      opacity: layer.opacity, fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'ellipse') {
    const rx = layer.w / 2, ry = layer.h / 2, k = 0.5522847498 // cubic circle constant
    const kx = rx * k, ky = ry * k
    const d = `M 0 ${f(-ry)} C ${f(kx)} ${f(-ry)} ${f(rx)} ${f(-ky)} ${f(rx)} 0` +
      ` C ${f(rx)} ${f(ky)} ${f(kx)} ${f(ry)} 0 ${f(ry)}` +
      ` C ${f(-kx)} ${f(ry)} ${f(-rx)} ${f(ky)} ${f(-rx)} 0` +
      ` C ${f(-rx)} ${f(-ky)} ${f(-kx)} ${f(-ry)} 0 ${f(-ry)} Z`
    return createPathLayer({
      d, bbox: { w: layer.w, h: layer.h }, scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation,
      opacity: layer.opacity, fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'line') {
    const w = layer.w
    return createPathLayer({
      d: `M ${f(-w / 2)} 0 L ${f(w / 2)} 0`, bbox: { w, h: Math.max(layer.strokeWidth, 0.001) },
      scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
      fill: 'none', stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  return null
}

/** Create an image layer. `aspect` (w/h) sizes the box so the image isn't
 *  distorted; defaults to a square. */
export function createImageLayer(filename: string, aspect = 1, partial: Partial<ImageLayer> = {}): ImageLayer {
  // Derive h from the *effective* width (a partial.w override included) so the
  // box keeps the image's aspect; partial can still override h explicitly.
  const w = partial.w ?? 0.6
  return {
    id: newId(), kind: 'image',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    filename, w, h: w / (aspect || 1),
    ...partial,
  }
}

// ── Image-layer asset loading ────────────────────────────────────────────────
const _imageCache = new Map<string, HTMLImageElement>()

/** Resolve an image layer's filename to a ComfyUI /view URL. */
export function imageLayerUrl(filename: string): string {
  return `/view?${new URLSearchParams({ filename, type: 'input' })}`
}

/** Preload every image layer's bitmap into the module cache so the synchronous
 *  `drawLocalLayer` can paint it. Resolves once all are loaded (or errored). */
export async function ensureLayerImages(layers: LocalLayer[]): Promise<void> {
  if (typeof window === 'undefined') return
  const jobs: Promise<unknown>[] = []
  for (const layer of layers) {
    if (layer.kind !== 'image') continue
    const url = imageLayerUrl(layer.filename)
    if (_imageCache.get(url)?.complete) continue
    jobs.push(new Promise((res) => {
      const im = new Image()
      im.onload = () => { _imageCache.set(url, im); res(null) }
      im.onerror = () => res(null)
      im.src = url
    }))
  }
  if (jobs.length) await Promise.all(jobs)
}

// ── Rendering ─────────────────────────────────────────────────────────────--

function hasPaint(paint: Paint | undefined): boolean {
  if (isGradient(paint)) return paint.stops.length > 0
  return !!paint && paint !== 'none' && paint !== 'transparent'
}

/**
 * Resolve a Paint to a canvas fillStyle. Solid colors pass through; gradients
 * are built against a local box `{ w, h }` (in the CURRENT drawing units, i.e.
 * pixels for rect/ellipse, local width-fraction units for paths) centered on
 * origin, so the gradient tracks the shape under any transform.
 */
function resolvePaint(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  box: { w: number; h: number },
): string | CanvasGradient {
  if (!isGradient(paint)) return paint
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset)
  let g: CanvasGradient
  if (paint.type === 'radial') {
    const r = Math.max(box.w, box.h) / 2
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(r, 0.0001))
  } else {
    const rad = ((paint.angle ?? 0) * Math.PI) / 180
    const hx = (Math.cos(rad) * box.w) / 2
    const hy = (Math.sin(rad) * box.h) / 2
    g = ctx.createLinearGradient(-hx, -hy, hx, hy)
  }
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color)
  return g
}

/** Split text into explicit-newline lines. */
function textLines(layer: TextLayer): string[] {
  return (layer.text ?? '').split('\n')
}

/**
 * Final render lines: explicit newlines, then — when the layer has a text box
 * (`boxW`) — greedy word-wrap each line to fit the box. A word longer than the
 * box overflows on its own line rather than breaking mid-word. Needs a 2D
 * context for measurement; without one, falls back to explicit lines only.
 */
export function wrappedTextLines(ctx: CanvasRenderingContext2D | null, layer: TextLayer, W: number): string[] {
  const manual = textLines(layer)
  const boxPx = (layer.boxW ?? 0) * W
  if (!ctx || !(boxPx > 0)) return manual
  applyFont(ctx, layer, W)
  const out: string[] = []
  for (const line of manual) {
    const words = line.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let cur = words[0]
    for (let i = 1; i < words.length; i++) {
      const candidate = `${cur} ${words[i]}`
      if (ctx.measureText(candidate).width <= boxPx) cur = candidate
      else { out.push(cur); cur = words[i] }
    }
    out.push(cur)
  }
  return out
}

export function applyFont(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
  ctx.font = `${layer.fontWeight} ${layer.fontSize * W}px ${cssFontStack(layer.fontFamily)}`
}

function cssFontStack(family: string): string {
  // Quote families with spaces; keep a generic fallback so canvas always draws.
  const quoted = /\s/.test(family) ? `"${family}"` : family
  return `${quoted}, sans-serif`
}

/**
 * Bounding box of a layer in PIXELS (un-rotated), centered on origin.
 * For text this measures the rendered glyph block. A 2D context is required
 * for text measurement; pass any scratch context.
 */
export function localLayerBox(
  ctx: CanvasRenderingContext2D | null,
  layer: LocalLayer,
  W: number,
  H: number,
): { w: number; h: number } {
  if (layer.kind === 'text') {
    const lines = wrappedTextLines(ctx, layer, W)
    const lineH = layer.fontSize * W * layer.lineHeight
    // With a text box, the box width IS the layer width (selection/handles
    // track the box, not the glyph extents).
    if ((layer.boxW ?? 0) > 0) {
      return { w: Math.max(layer.boxW! * W, 4), h: Math.max(lines.length * lineH, lineH) }
    }
    let maxW = 0
    if (ctx) {
      applyFont(ctx, layer, W)
      for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln || ' ').width)
    } else {
      // Rough fallback without measurement.
      maxW = Math.max(...lines.map(l => (l.length || 1))) * layer.fontSize * W * 0.6
    }
    return { w: Math.max(maxW, 4), h: Math.max(lines.length * lineH, lineH) }
  }
  if (layer.kind === 'line') {
    return { w: layer.w * W, h: Math.max(layer.strokeWidth * W, 6) }
  }
  if (layer.kind === 'path') {
    const s = (layer.scale || 1) * W
    return { w: Math.max(layer.bbox.w * s, 4), h: Math.max(layer.bbox.h * s, 4) }
  }
  return { w: (layer as RectLayer).w * W, h: (layer as RectLayer).h * W }
}

/** Draw a single local layer onto a 2D context sized W×H. */
// Clip the context to a layer's mask region (canvas space). Caller wraps this in
// save()/restore(). No-op shape support beyond rect/ellipse for now.
function applyMaskClip(ctx: CanvasRenderingContext2D, mask: LayerMask, W: number, H: number) {
  const cx = mask.x * W, cy = mask.y * H, w = Math.max(0, mask.w * W), h = Math.max(0, mask.h * W)
  ctx.beginPath()
  if (mask.kind === 'ellipse') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
  else ctx.rect(cx - w / 2, cy - h / 2, w, h)
  ctx.clip()
}

export function drawLocalLayer(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
  maskLayer?: LocalLayer | null,
) {
  // Layer mask: clip this layer to another layer's alpha silhouette (Figma
  // "use as mask"). Render the content, then keep only where the mask layer's
  // alpha is, via destination-in on an offscreen.
  if (maskLayer) {
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.round(W))
    off.height = Math.max(1, Math.round(H))
    const octx = off.getContext('2d')
    if (octx) {
      drawLocalLayerSelf(octx, layer, W, H)
      octx.globalCompositeOperation = 'destination-in'
      drawLocalLayerSelf(octx, maskLayer, W, H)
      octx.globalCompositeOperation = 'source-over'
      // The layer's blend mode applies at the final composite against the real
      // backdrop (inside the offscreen it blends against transparency = no-op).
      ctx.save()
      ctx.globalCompositeOperation = localBlendOp(layer)
      ctx.drawImage(off, 0, 0)
      ctx.restore()
      return
    }
  }
  drawLocalLayerSelf(ctx, layer, W, H)
}

// A layer's own paint, including its crop (rect/ellipse) region — but NOT any
// layer-mask, which drawLocalLayer applies around this.
function drawLocalLayerSelf(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number) {
  if (layer.mask) {
    ctx.save()
    applyMaskClip(ctx, layer.mask, W, H)
    paintLayer(ctx, layer, W, H)
    ctx.restore()
  } else {
    paintLayer(ctx, layer, W, H)
  }
}

/** A local layer's blend mode → canvas composite op ('normal' = source-over). */
export function localBlendOp(layer: { blend?: string }): GlobalCompositeOperation {
  return WIRED_BLEND_OP[layer.blend ?? 'normal'] ?? 'source-over'
}

// Composite an inner shadow INTO a rendered layer offscreen. Standard recipe:
// take the inverse of the content alpha, draw it with canvas shadow params (the
// shadow spills inward across the silhouette edge), keep only the part inside
// the content (destination-in), then stamp that over the content.
function compositeInnerShadow(off: HTMLCanvasElement, fx: InnerShadowEffect, W: number) {
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = off.width; c.height = off.height
    return c
  }
  const inv = mk()
  const ictx = inv.getContext('2d')
  const sh = mk()
  const sctx = sh.getContext('2d')
  if (!ictx || !sctx) return
  ictx.fillStyle = '#000'
  ictx.fillRect(0, 0, inv.width, inv.height)
  ictx.globalCompositeOperation = 'destination-out'
  ictx.drawImage(off, 0, 0)
  sctx.shadowColor = fx.color
  sctx.shadowBlur = Math.max(0, fx.blur * W)
  sctx.shadowOffsetX = fx.x * W
  sctx.shadowOffsetY = fx.y * W
  sctx.drawImage(inv, 0, 0)
  sctx.shadowColor = 'transparent'
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(off, 0, 0)
  // off's context still carries the layer's translate/rotate from the content
  // draw — stamp the shadow in identity space or it lands displaced.
  const octx = off.getContext('2d')
  if (octx) {
    octx.save()
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.drawImage(sh, 0, 0)
    octx.restore()
  }
}

function paintLayer(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
) {
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const blendOp = localBlendOp(layer)
  const fx = (layer.effects ?? []).filter(e => e.visible)
  const shadow = fx.find((e): e is DropShadowEffect => e.type === 'drop_shadow')
  const blur = fx.find((e): e is LayerBlurEffect => e.type === 'layer_blur')
  const inner = fx.find((e): e is InnerShadowEffect => e.type === 'inner_shadow')
  // (background_blur is a stack-level effect — paintLayerStack applies it
  // against the backdrop before this layer paints.)

  // Effected path: render the layer to an offscreen at canvas size, then
  // composite it with inner shadow / drop shadow / blur. Works identically for
  // text, shapes, vectors and images, and because bakeOverlay() renders through
  // here the effects are baked into generation exactly as previewed.
  if (shadow || blur || inner) {
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.round(W))
    off.height = Math.max(1, Math.round(H))
    const octx = off.getContext('2d')
    if (octx) {
      octx.translate(layer.x * W, layer.y * H)
      if (layer.rotation) octx.rotate((layer.rotation * Math.PI) / 180)
      drawLayerContent(octx, layer, W)
      if (inner) compositeInnerShadow(off, inner, W)
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.globalCompositeOperation = blendOp
      if (blur) ctx.filter = `blur(${Math.max(0, blur.radius * W)}px)`
      if (shadow) {
        ctx.shadowColor = shadow.color
        ctx.shadowBlur = Math.max(0, shadow.blur * W)
        ctx.shadowOffsetX = shadow.x * W
        ctx.shadowOffsetY = shadow.y * W
      }
      ctx.drawImage(off, 0, 0)
      ctx.restore()
      return
    }
  }

  // Fast path (no effects): draw inline, identical to before.
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.globalCompositeOperation = blendOp
  ctx.translate(layer.x * W, layer.y * H)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)
  drawLayerContent(ctx, layer, W)
  ctx.restore()
}

// Per-kind shape rendering. Caller has already applied opacity + the layer's
// translate/rotate to `ctx`; here we just paint the geometry at the origin.
function drawLayerContent(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number) {
  if (layer.kind === 'text') {
    drawText(ctx, layer, W)
  } else if (layer.kind === 'rect') {
    const w = layer.w * W, h = layer.h * W
    const r = Math.max(0, Math.min(layer.radius * W, Math.min(w, h) / 2))
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    if (hasPaint(layer.fill)) { ctx.fillStyle = resolvePaint(ctx, layer.fill, { w, h }); ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = layer.stroke; ctx.stroke()
    }
  } else if (layer.kind === 'ellipse') {
    const w = layer.w * W, h = layer.h * W
    ctx.beginPath()
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
    if (hasPaint(layer.fill)) { ctx.fillStyle = resolvePaint(ctx, layer.fill, { w, h }); ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = layer.stroke; ctx.stroke()
    }
  } else if (layer.kind === 'path') {
    drawPath(ctx, layer, W)
  } else if (layer.kind === 'line') {
    const w = layer.w * W
    ctx.beginPath()
    ctx.moveTo(-w / 2, 0)
    ctx.lineTo(w / 2, 0)
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, layer.strokeWidth * W)
    ctx.strokeStyle = hasPaint(layer.stroke) ? layer.stroke : '#ffffff'
    ctx.stroke()
  } else if (layer.kind === 'image') {
    const w = layer.w * W, h = layer.h * W
    const img = _imageCache.get(imageLayerUrl(layer.filename))
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
    } else {
      // Not loaded yet — faint placeholder; a preload + re-render fills it in.
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(-w / 2, -h / 2, w, h)
    }
  }
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
  const lines = wrappedTextLines(ctx, layer, W)
  const lineH = layer.fontSize * W * layer.lineHeight
  applyFont(ctx, layer, W)
  ctx.textBaseline = 'middle'
  ctx.textAlign = layer.align
  // Alignment anchors against the text box when one is set, else the widest line.
  let blockW: number
  if ((layer.boxW ?? 0) > 0) {
    blockW = layer.boxW! * W
  } else {
    blockW = 0
    for (const ln of lines) blockW = Math.max(blockW, ctx.measureText(ln || ' ').width)
  }
  const anchorX = layer.align === 'left' ? -blockW / 2 : layer.align === 'right' ? blockW / 2 : 0
  const totalH = lines.length * lineH
  const startY = -totalH / 2 + lineH / 2
  const stroke = hasPaint(layer.strokeColor) && layer.strokeWidth > 0
  if (stroke) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = layer.strokeWidth * W
    ctx.strokeStyle = layer.strokeColor
  }
  ctx.fillStyle = layer.color
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineH
    if (stroke) ctx.strokeText(lines[i], anchorX, y)
    ctx.fillText(lines[i], anchorX, y)
  }
}

/**
 * Module-cached Path2D per `d` string — building a Path2D parses the path data,
 * which we'd otherwise repeat every animation frame.
 */
const _pathCache = new Map<string, Path2D>()
function path2dFor(d: string): Path2D | null {
  if (!d) return null
  let p = _pathCache.get(d)
  if (!p) {
    try { p = new Path2D(d) } catch { return null }
    if (_pathCache.size > 400) _pathCache.clear()
    _pathCache.set(d, p)
  }
  return p
}

/**
 * Draw a vector path layer. The context is already translated to the layer
 * center and rotated; here we scale into the path's local units (1 unit =
 * canvas width) times the layer's uniform `scale`, then fill/stroke the cached
 * Path2D. Gradients resolve against the un-scaled local bbox.
 */
function drawPath(ctx: CanvasRenderingContext2D, layer: PathLayer, W: number) {
  const p = path2dFor(layer.d)
  if (!p) return
  const s = (layer.scale || 1) * W
  ctx.save()
  ctx.scale(s, s)
  if (hasPaint(layer.fill)) {
    ctx.fillStyle = resolvePaint(ctx, layer.fill, layer.bbox)
    ctx.fill(p, layer.fillRule || 'nonzero')
  }
  if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth
    ctx.strokeStyle = layer.stroke
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke(p)
  }
  ctx.restore()
}

/** Draw all local layers (bottom→top order = array order). */
// One ordered stack item: a wired image layer (drawn via its own closure) or a
// local layer. The single source of truth for stack rendering — both canvases
// (Frame node, Compositor modal) and the bake go through paintLayerStack, so
// masking/effects can't drift between them (the bug-class this prevents).
export type StackItem =
  | { type: 'wired'; draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void }
  | { type: 'local'; layer: LocalLayer }

// Figma background blur: blur the ALREADY-PAINTED backdrop within the layer's
// silhouette, then the layer paints on top. Operates in device space so it's
// correct under the dpr transform renderers apply to the stack canvas.
function applyBackdropBlur(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  localLayers: LocalLayer[],
  W: number,
  H: number,
  radius: number,
) {
  if (!(radius > 0)) return
  const t = ctx.getTransform()
  const dev = ctx.canvas
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = dev.width; c.height = dev.height
    return c
  }
  // Silhouette: the layer's own alpha (full opacity, no effects) at device scale.
  const sil = mk()
  const silctx = sil.getContext('2d')
  if (!silctx) return
  silctx.setTransform(t)
  const ghost = { ...layer, opacity: 1, effects: undefined, blend: undefined } as LocalLayer
  const maskLayer = layer.maskedById ? localLayers.find(l => l.id === layer.maskedById) ?? null : null
  drawLocalLayer(silctx, ghost, W, H, maskLayer)
  // Blur the current backdrop, clip to the silhouette, stamp it back.
  const out = mk()
  const octx = out.getContext('2d')
  if (!octx) return
  octx.filter = `blur(${Math.max(0, radius * W * t.a)}px)`
  octx.drawImage(dev, 0, 0)
  octx.filter = 'none'
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(sil, 0, 0)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(out, 0, 0)
  ctx.restore()
}

export function paintLayerStack(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  items: StackItem[],
  localLayers: LocalLayer[],
  skip?: (layer: LocalLayer) => boolean,
  /** Motion time in seconds. Undefined ⇒ static render, exactly as before. */
  t?: number,
  motion?: { fps: number; duration: number },
) {
  // Layers used as a mask (referenced by another's maskedById) only clip — they
  // don't paint on their own.
  const maskIds = new Set<string>()
  for (const l of localLayers) if (l.maskedById) maskIds.add(l.maskedById)
  for (const item of items) {
    if (item.type === 'wired') { item.draw(ctx, W, H); continue }
    const layer = item.layer
    if (layerHidden(layer)) continue
    if (skip?.(layer)) continue
    if (maskIds.has(layer.id)) continue
    const maskLayer = layer.maskedById ? localLayers.find(l => l.id === layer.maskedById) ?? null : null
    // Enter the motion path when the layer OR its mask animates (a static
    // photo masked by an animated numeral must still track the mask). Backdrop
    // blur runs only for layers that actually draw, so an off-screen layer
    // never smears the backdrop.
    const motionActive = t !== undefined && motion && _motionPainterImpl
      && (layer.animation || maskLayer?.animation)
    if (motionActive) {
      const { motionStateFor, drawLayerWithMotion, identityState } = _motionPainterImpl!
      const st = layer.animation ? motionStateFor(layer, t!, motion!) : identityState()
      if (st) {
        if (!st.visible) continue
        const maskState = maskLayer?.animation ? motionStateFor(maskLayer, t!, motion!) : null
        if (maskState && !maskState.visible) continue // content hidden until its mask is on screen
        const bgBlur = layer.effects?.find(
          (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
        )
        if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)
        drawLayerWithMotion(ctx, layer, W, H, maskLayer, st, maskState)
        continue
      }
    }
    const bgBlur = layer.effects?.find(
      (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
    )
    if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)
    drawLocalLayer(ctx, layer, W, H, maskLayer)
  }
}

export function drawLocalLayers(
  ctx: CanvasRenderingContext2D,
  layers: LocalLayer[],
  W: number,
  H: number,
) {
  paintLayerStack(ctx, W, H, layers.map(l => ({ type: 'local', layer: l })), layers)
}

/** Blend-mode name → canvas composite op (shared by node + modal wired draws). */
export const WIRED_BLEND_OP: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  soft_light: 'soft-light', hard_light: 'hard-light', difference: 'difference',
  lighten: 'lighten', darken: 'darken', add: 'lighter',
}

/** Transform of a wired image layer (normalized x/y, scale, rotation, blend). */
export interface WiredTransform {
  x: number; y: number; scale: number; rotation: number; opacity: number; blend: string
}

/**
 * Draw one wired image layer — the SINGLE source of truth shared by the Frame
 * node and the Compositor modal so their previews can't drift apart. The image
 * is aspect-fit (contain) into the W×H artboard, then translated by the layer's
 * normalized x/y, rotated, and scaled. Fit is computed from the *actual* image
 * (not a separately-tracked dimension cache), so it never falls back to a
 * stretch-fill when a cache entry is missing.
 */
export function drawWiredImageLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined | null,
  layer: WiredTransform,
  W: number,
  H: number,
) {
  if (!img || !img.complete || !img.naturalWidth) return
  const cAspect = W / H, iAspect = img.naturalWidth / img.naturalHeight
  let fitW: number, fitH: number
  if (iAspect > cAspect) { fitW = W; fitH = W / iAspect } else { fitH = H; fitW = H * iAspect }
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.globalCompositeOperation = WIRED_BLEND_OP[layer.blend] ?? 'source-over'
  ctx.translate(W / 2 + layer.x * W, H / 2 + layer.y * H)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.scale(layer.scale, layer.scale)
  ctx.drawImage(img, -fitW / 2, -fitH / 2, fitW, fitH)
  ctx.restore()
}

/**
 * Bake local layers into a transparent RGBA PNG blob at W×H. Returns null if
 * there are no layers. Fonts must already be loaded (call `ensureLayerFonts`).
 */
export function bakeOverlay(layers: LocalLayer[], W: number, H: number): Promise<Blob | null> {
  if (!layers.length) return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height) // stay transparent
  drawLocalLayers(ctx, layers, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/**
 * Ensure every text layer's font face is loaded so canvas text renders with the
 * real glyphs instead of a fallback. Resolves once all are ready (or timed out).
 */
export async function ensureLayerFonts(layers: LocalLayer[], W: number): Promise<void> {
  if (typeof document === 'undefined' || !(document as any).fonts) return
  const jobs: Promise<unknown>[] = []
  for (const layer of layers) {
    if (layer.kind !== 'text') continue
    const spec = `${layer.fontWeight} ${Math.max(8, layer.fontSize * W)}px ${cssFontStack(layer.fontFamily)}`
    try { jobs.push((document as any).fonts.load(spec)) } catch { /* ignore */ }
  }
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 1500))])
}
