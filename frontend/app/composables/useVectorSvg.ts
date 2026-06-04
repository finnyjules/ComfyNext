/**
 * SVG ↔ PathLayer bridge — the spine shared by the pen tool, file import, and
 * the AI vector features (Recraft text→SVG, VTracer/Recraft vectorize). It uses
 * paper.js purely as a headless geometry engine (parse SVG, normalize, read
 * paths) — paper never owns a visible canvas; our own Canvas 2D renderer
 * (`drawLocalLayer`) draws the resulting PathLayers.
 *
 * Coordinate contract (matches useCompositorLayers): a PathLayer's `d` is in
 * LOCAL units where 1 unit = canvas width, centered on the import's midpoint.
 * Every layer from one import shares the same center (x/y = 0.5) and `scale`, so
 * a multi-color icon re-assembles exactly with each sub-shape's position carried
 * inside its own `d`. No artboard aspect is needed at import time.
 */
import { createPathLayer, type PathLayer, type Paint } from '~/composables/useCompositorLayers'
import type Paper from 'paper'

// paper.js touches browser globals at import time, so it must NOT load during
// SSR. We lazy-import it on first client use and cache one detached PaperScope
// (a scope, not the global `paper`, keeps paper's mutable state out of the app).
// This also keeps paper's ~300kb out of the initial bundle.
let _paperMod: typeof Paper | null = null
let _scope: Paper.PaperScope | null = null
async function paperScope(): Promise<Paper.PaperScope> {
  if (!_paperMod) _paperMod = (await import('paper')).default
  if (!_scope) {
    _scope = new _paperMod.PaperScope()
    // Headless: a project needs a size; we never attach a real canvas.
    _scope.setup(new _scope.Size(1024, 1024))
  }
  _scope.activate()
  return _scope
}

function paperColorToCss(c: Paper.Color | null | undefined): string {
  if (!c) return 'none'
  try { return c.alpha === 0 ? 'none' : c.toCSS(true) } catch { return 'none' }
}

interface ImportOpts {
  /** Fraction of canvas width the whole import should span (default 0.6). */
  targetWidth?: number
  /** Center placement in normalized artboard coords (default 0.5, 0.5). */
  cx?: number
  cy?: number
}

/**
 * Parse an SVG string into one or more PathLayers (one per leaf path, so
 * per-shape fills/strokes are preserved). Returns [] if nothing usable.
 */
export async function svgToPathLayers(svg: string, opts: ImportOpts = {}): Promise<PathLayer[]> {
  if (!svg || typeof window === 'undefined') return []
  const targetWidth = opts.targetWidth ?? 0.6
  const cx = opts.cx ?? 0.5
  const cy = opts.cy ?? 0.5

  const sc = await paperScope()
  const project = sc.project
  let root: Paper.Item | null = null
  try {
    // expandShapes turns <rect>/<circle>/… into real Paths so we only handle
    // Path/CompoundPath below. applyMatrix bakes transforms into geometry.
    root = project.importSVG(svg, { expandShapes: true, applyMatrix: true, insert: true })
  } catch (err) {
    console.error('[useVectorSvg] importSVG failed:', err)
    project.clear()
    return []
  }
  if (!root) { project.clear(); return [] }

  // Collect leaf path items (Path / CompoundPath) anywhere in the tree.
  const paths: Paper.PathItem[] = []
  const walk = (item: Paper.Item) => {
    const cn = item.className
    if (cn === 'Path' || cn === 'CompoundPath') { paths.push(item as Paper.PathItem); return }
    if (item.children) for (const ch of item.children) walk(ch)
  }
  walk(root)

  if (!paths.length) { project.clear(); return [] }

  // Whole-import bounds → normalization factor (svg units → width-fractions).
  const B = root.bounds
  const k = B.width > 0 ? targetWidth / B.width : 1
  const bbox = { w: Math.max(B.width * k, 0.001), h: Math.max(B.height * k, 0.001) }

  // Map svg coords → local: (p - B.center) * k. paper composes right-to-left,
  // so scale(k) after translate(-center) yields exactly that.
  const m = new sc.Matrix()
  m.scale(k)
  m.translate(-B.center.x, -B.center.y)

  const layers: PathLayer[] = []
  for (const item of paths) {
    let d = ''
    try {
      const clone = item.clone({ insert: false }) as Paper.PathItem
      clone.transform(m)
      d = clone.getPathData(undefined, 4)
      clone.remove()
    } catch { continue }
    if (!d) continue

    const fill: Paint = paperColorToCss((item as any).fillColor)
    const stroke = paperColorToCss((item as any).strokeColor)
    const strokeWidth = stroke !== 'none' ? ((item as any).strokeWidth || 0) * k : 0
    const fillRule: PathLayer['fillRule'] =
      (item as any).windingRule === 'evenodd' ? 'evenodd' : 'nonzero'

    layers.push(createPathLayer({
      d, bbox: { ...bbox }, scale: 1, x: cx, y: cy,
      fill, fillRule, stroke, strokeWidth,
    }))
  }

  project.clear()
  return layers
}

// ── Direct anchor editing (node mode) ────────────────────────────────────────
// A path's segments expressed in NORMALIZED artboard coords (0..1) so the
// editor overlay can render/drag them without per-layer transform math. inH/outH
// are absolute handle positions (null = no handle / corner).
export interface PathSegment {
  point: { x: number; y: number }
  inH: { x: number; y: number } | null
  outH: { x: number; y: number } | null
}
export interface PathSegments { segments: PathSegment[]; closed: boolean }

/** Extract a path layer's segments into normalized artboard coords. */
export async function pathLayerToSegments(layer: PathLayer, dims: { w: number; h: number }): Promise<PathSegments> {
  const sc = await paperScope()
  const W = 1000, H = (W * dims.h) / dims.w
  const m = new sc.Matrix()
  m.translate(layer.x * W, layer.y * H)
  m.rotate(layer.rotation || 0, new sc.Point(0, 0))
  m.scale((layer.scale || 1) * W)
  let path: any
  try { path = new sc.Path(layer.d); path.transform(m) } catch { sc.project.clear(); return { segments: [], closed: false } }
  const segs: PathSegment[] = path.segments.map((s: any) => ({
    point: { x: s.point.x / W, y: s.point.y / H },
    inH: s.handleIn && (s.handleIn.x || s.handleIn.y)
      ? { x: (s.point.x + s.handleIn.x) / W, y: (s.point.y + s.handleIn.y) / H } : null,
    outH: s.handleOut && (s.handleOut.x || s.handleOut.y)
      ? { x: (s.point.x + s.handleOut.x) / W, y: (s.point.y + s.handleOut.y) / H } : null,
  }))
  const closed = !!path.closed
  sc.project.clear()
  return { segments: segs, closed }
}

/** Rebuild a path layer from edited (normalized) segments, preserving style. */
export async function segmentsToPathLayer(
  segs: PathSegments, base: PathLayer, dims: { w: number; h: number },
): Promise<PathLayer | null> {
  if (segs.segments.length < 2) return null
  const sc = await paperScope()
  const ar = dims.h / dims.w
  // normalized → width-fraction (x = nx, y = ny*ar)
  const wf = (p: { x: number; y: number }) => new sc.Point(p.x, p.y * ar)
  const path = new sc.Path()
  for (const s of segs.segments) {
    const pt = wf(s.point)
    const hIn = s.inH ? wf(s.inH).subtract(pt) : null
    const hOut = s.outH ? wf(s.outH).subtract(pt) : null
    path.add(new sc.Segment(pt, hIn, hOut))
  }
  path.closed = segs.closed
  const b = path.bounds
  if (!b || b.width < 1e-9 && b.height < 1e-9) { sc.project.clear(); return null }
  path.transform(new sc.Matrix().translate(-b.center.x, -b.center.y)) // center on bbox
  const d = path.getPathData(undefined, 4)
  sc.project.clear()
  return createPathLayer({
    d, scale: 1,
    bbox: { w: Math.max(b.width, 0.001), h: Math.max(b.height, 0.001) },
    x: b.center.x, y: b.center.y / ar,
    fill: base.fill, fillRule: base.fillRule, stroke: base.stroke,
    strokeWidth: base.strokeWidth, opacity: base.opacity, rotation: 0,
  })
}

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude'

/**
 * Combine 2+ path layers with a boolean op. Operands are transformed into a
 * common artboard-pixel space (each layer's x/y/scale/rotation + its local `d`),
 * combined via paper.js, then re-normalized into a single fresh PathLayer in the
 * standard local frame. Fill/stroke are inherited from the first (bottom) layer.
 * `dims` supplies the artboard aspect; the absolute size cancels out.
 */
export async function pathLayerBoolean(
  layers: PathLayer[],
  op: BooleanOp,
  dims: { w: number; h: number },
): Promise<PathLayer | null> {
  const paths = layers.filter(l => l.kind === 'path' && l.d)
  if (paths.length < 2) return null
  const sc = await paperScope()
  const W = 1000, H = (W * dims.h) / dims.w

  // Layer local `d` → artboard pixels: translate(x*W,y*H)·rotate(deg)·scale(s*W).
  const toPixel = (l: PathLayer) => {
    const m = new sc.Matrix()
    m.translate(l.x * W, l.y * H)
    m.rotate(l.rotation || 0, new sc.Point(0, 0))
    m.scale((l.scale || 1) * W)
    const p = new sc.CompoundPath(l.d)
    p.transform(m)
    return p
  }

  let acc: any
  try {
    acc = toPixel(paths[0])
    for (let i = 1; i < paths.length; i++) {
      const next = toPixel(paths[i])
      const combined = acc[op](next)
      acc.remove(); next.remove()
      acc = combined
    }
  } catch (err) {
    console.error('[useVectorSvg] boolean failed:', err)
    sc.project.clear()
    return null
  }

  const b = acc.bounds
  if (!b || b.width < 1e-6 || b.height < 1e-6) { sc.project.clear(); return null }

  // Re-normalize result (pixels) → local frame centered on its bbox, scale 1.
  const inv = new sc.Matrix()
  inv.scale(1 / W)
  inv.translate(-b.center.x, -b.center.y)
  acc.transform(inv)
  const d = acc.getPathData(undefined, 4)
  const fillRule: PathLayer['fillRule'] = (acc as any).windingRule === 'evenodd' ? 'evenodd' : 'nonzero'
  sc.project.clear()

  const base = paths[0]
  return createPathLayer({
    d, scale: 1,
    bbox: { w: Math.max(b.width / W, 0.001), h: Math.max(b.height / W, 0.001) },
    x: b.center.x / W, y: b.center.y / H,
    fill: base.fill, fillRule, stroke: base.stroke, strokeWidth: base.strokeWidth,
  })
}

/**
 * Export PathLayers back to a standalone SVG string. `aspect` (w/h) of the
 * artboard maps the layers' shared local frame into a square-agnostic viewBox.
 * Used for save/round-trip and "copy as SVG".
 */
export function pathLayersToSvg(layers: PathLayer[], aspect = 1): string {
  const VB = 1000
  const W = VB, H = Math.round(VB / (aspect || 1))
  const parts: string[] = []
  for (const l of layers) {
    if (l.kind !== 'path' || !l.d) continue
    const s = (l.scale || 1) * W
    // Local (width-fraction, centered) → viewBox px: scale by W, place at center.
    const tx = l.x * W
    const ty = l.y * H
    const fill = paintToSvg(l.fill)
    const strokeAttr = l.stroke && l.stroke !== 'none' && l.strokeWidth > 0
      ? ` stroke="${esc(l.stroke)}" stroke-width="${(l.strokeWidth * s).toFixed(3)}"` : ''
    const transform = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${l.rotation || 0}) scale(${s.toFixed(4)})`
    parts.push(
      `<path d="${esc(l.d)}" transform="${transform}" fill="${fill.color}" fill-rule="${l.fillRule || 'nonzero'}"` +
      `${fill.opacityAttr}${strokeAttr} opacity="${l.opacity ?? 1}"/>`,
    )
  }
  const defs = '' // gradient <defs> can be emitted here in a later pass
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${defs}${parts.join('')}</svg>`
}

function paintToSvg(p: Paint | undefined): { color: string; opacityAttr: string } {
  if (!p || p === 'none' || p === 'transparent') return { color: 'none', opacityAttr: '' }
  if (typeof p === 'string') return { color: esc(p), opacityAttr: '' }
  // Gradient: fall back to its first stop for v1 export (full gradient defs TBD).
  const first = p.stops[0]?.color ?? '#000000'
  return { color: esc(first), opacityAttr: '' }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
