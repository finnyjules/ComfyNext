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

export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line'

interface LayerCommon {
  id: string
  kind: LocalLayerKind
  x: number          // normalized center X (0..1 of width)
  y: number          // normalized center Y (0..1 of height)
  rotation: number   // degrees
  opacity: number    // 0..1
}

export interface TextLayer extends LayerCommon {
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight: 400 | 700
  fontSize: number       // normalized to canvas width
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number     // multiplier
  strokeColor: string
  strokeWidth: number    // normalized to canvas width (0 = no outline)
}

export interface RectLayer extends LayerCommon {
  kind: 'rect'
  w: number; h: number    // normalized to canvas width
  fill: string            // '' / 'none' = no fill
  stroke: string
  strokeWidth: number     // normalized to canvas width
  radius: number          // normalized to canvas width
}

export interface EllipseLayer extends LayerCommon {
  kind: 'ellipse'
  w: number; h: number
  fill: string
  stroke: string
  strokeWidth: number
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

export type LocalLayer = TextLayer | RectLayer | EllipseLayer | LineLayer | ImageLayer

let _idSeq = 0
function newId(): string {
  _idSeq += 1
  return `ll-${Date.now().toString(36)}-${_idSeq}`
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

/** Create an image layer. `aspect` (w/h) sizes the box so the image isn't
 *  distorted; defaults to a square. */
export function createImageLayer(filename: string, aspect = 1, partial: Partial<ImageLayer> = {}): ImageLayer {
  const w = 0.6
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

function hasPaint(color: string | undefined): boolean {
  return !!color && color !== 'none' && color !== 'transparent'
}

/** Split text into lines on explicit newlines (no auto-wrap in v1). */
function textLines(layer: TextLayer): string[] {
  return (layer.text ?? '').split('\n')
}

function applyFont(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
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
    const lines = textLines(layer)
    const lineH = layer.fontSize * W * layer.lineHeight
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
  return { w: (layer as RectLayer).w * W, h: (layer as RectLayer).h * W }
}

/** Draw a single local layer onto a 2D context sized W×H. */
export function drawLocalLayer(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
) {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(layer.x * W, layer.y * H)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)

  if (layer.kind === 'text') {
    drawText(ctx, layer, W)
  } else if (layer.kind === 'rect') {
    const w = layer.w * W, h = layer.h * W
    const r = Math.max(0, Math.min(layer.radius * W, Math.min(w, h) / 2))
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    if (hasPaint(layer.fill)) { ctx.fillStyle = layer.fill; ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = layer.stroke; ctx.stroke()
    }
  } else if (layer.kind === 'ellipse') {
    const w = layer.w * W, h = layer.h * W
    ctx.beginPath()
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
    if (hasPaint(layer.fill)) { ctx.fillStyle = layer.fill; ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = layer.stroke; ctx.stroke()
    }
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
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
  const lines = textLines(layer)
  const lineH = layer.fontSize * W * layer.lineHeight
  applyFont(ctx, layer, W)
  ctx.textBaseline = 'middle'
  ctx.textAlign = layer.align
  let maxW = 0
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln || ' ').width)
  // Anchor X per alignment (block is centered on origin).
  const anchorX = layer.align === 'left' ? -maxW / 2 : layer.align === 'right' ? maxW / 2 : 0
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

/** Draw all local layers (bottom→top order = array order). */
export function drawLocalLayers(
  ctx: CanvasRenderingContext2D,
  layers: LocalLayer[],
  W: number,
  H: number,
) {
  for (const layer of layers) drawLocalLayer(ctx, layer, W, H)
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
