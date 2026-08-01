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
import { paintPrimaryColor } from '~/lib/spacetype/fillTile'
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

/** One leaf path from an imported SVG, in normalized import space (the whole
 *  import scaled so its bounds span `targetWidth`, centred on its own midpoint).
 *  Deliberately free of any consumer's layer/object type: the Compositor maps
 *  these to PathLayers, 3D Studio maps them to svgPath primitives. */
export interface SvgLeafPath {
  d: string
  /** CSS colour, or 'none'. */
  fill: string
  /** CSS colour, or 'none'. */
  stroke: string
  /** Already multiplied by the import's normalization factor. */
  strokeWidth: number
  fillRule: 'nonzero' | 'evenodd'
}

export interface SvgImportOpts {
  /** Fraction of the target space the whole import should span. REQUIRED: this
   *  is the one number that differs between consumers (the Compositor passes a
   *  canvas fraction, 3D Studio a scene size), so defaulting it here would let a
   *  caller silently inherit the other consumer's units and produce
   *  plausible-looking geometry at the wrong scale. */
  targetWidth: number
}

/** Normalized bounds of the whole import, in the same space as each `d`. */
export interface SvgLeafResult {
  paths: SvgLeafPath[]
  bbox: { w: number; h: number }
}

/**
 * Pure normalization maths for an SVG import: given the raw bounds of the
 * whole import and the target width it should span, returns the scale factor
 * and resulting bbox. Split out from `svgToLeafPaths` (which needs paper.js
 * and a browser) so this arithmetic can be unit tested directly. The
 * `width > 0` guard matters because a degenerate SVG (a single vertical line,
 * a point) has zero-width bounds — without it `k` would be `Infinity`/`NaN`
 * and silently poison every downstream transform instead of falling back to
 * an identity scale.
 */
export function svgNormalization(
  bounds: { width: number; height: number },
  targetWidth: number,
): { k: number; bbox: { w: number; h: number } } {
  const k = bounds.width > 0 ? targetWidth / bounds.width : 1
  const bbox = { w: Math.max(bounds.width * k, 0.001), h: Math.max(bounds.height * k, 0.001) }
  return { k, bbox }
}

/**
 * Parse an SVG string into leaf paths in normalized import space. Shared core
 * behind both `svgToPathLayers` (Compositor) and 3D Studio's importer — the
 * parsing, normalization and coordinate contract live here so both consumers
 * see the same geometry.
 */
export async function svgToLeafPaths(svg: string, opts: SvgImportOpts): Promise<SvgLeafResult> {
  if (!svg || typeof window === 'undefined') return { paths: [], bbox: { w: 0, h: 0 } }
  const { targetWidth } = opts

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
    return { paths: [], bbox: { w: 0, h: 0 } }
  }
  if (!root) { project.clear(); return { paths: [], bbox: { w: 0, h: 0 } } }

  // Collect leaf path items (Path / CompoundPath) anywhere in the tree.
  const paths: Paper.PathItem[] = []
  const walk = (item: Paper.Item) => {
    const cn = item.className
    if (cn === 'Path' || cn === 'CompoundPath') { paths.push(item as Paper.PathItem); return }
    if (item.children) for (const ch of item.children) walk(ch)
  }
  walk(root)

  if (!paths.length) { project.clear(); return { paths: [], bbox: { w: 0, h: 0 } } }

  // Whole-import bounds → normalization factor (svg units → width-fractions).
  const B = root.bounds
  const { k, bbox } = svgNormalization({ width: B.width, height: B.height }, targetWidth)

  // Map svg coords → local: (p - B.center) * k. paper composes right-to-left,
  // so scale(k) after translate(-center) yields exactly that.
  const m = new sc.Matrix()
  m.scale(k)
  m.translate(-B.center.x, -B.center.y)

  const leafPaths: SvgLeafPath[] = []
  for (const item of paths) {
    let d = ''
    try {
      const clone = item.clone({ insert: false }) as Paper.PathItem
      clone.transform(m)
      d = clone.getPathData(undefined, 4)
      clone.remove()
    } catch { continue }
    if (!d) continue

    const fill = paperColorToCss((item as any).fillColor)
    const stroke = paperColorToCss((item as any).strokeColor)
    const strokeWidth = stroke !== 'none' ? ((item as any).strokeWidth || 0) * k : 0
    const fillRule: SvgLeafPath['fillRule'] =
      (item as any).windingRule === 'evenodd' ? 'evenodd' : 'nonzero'

    leafPaths.push({ d, fill, stroke, strokeWidth, fillRule })
  }

  project.clear()
  return { paths: leafPaths, bbox }
}

// paper's classes reached through the scope instance rather than through the
// `import type Paper` default, which is a type and not a namespace — spelling
// these `Paper.Path` would add to this file's existing TS2503 baseline. While
// that baseline stands these widen to `any` (same as `let acc: any` above);
// they tighten to the real classes for free the day the import is fixed.
type PaperScopeT = Awaited<ReturnType<typeof paperScope>>
type PaperPath = InstanceType<PaperScopeT['Path']>
type PaperPathItem = ReturnType<PaperPath['unite']>

/**
 * Replace every stroke-only path (fill 'none', non-zero strokeWidth) with a
 * FILLED outline of its stroke, so it has area to extrude. Filled paths pass
 * through untouched; a path with neither fill nor stroke is dropped.
 *
 * This is not an edge case: Lucide (this repo's own icon set), Feather and
 * Heroicons-outline are entirely stroke-only, so without this step the single
 * most likely thing a user pastes — an icon — imports as nothing at all.
 *
 * Built from paper's boolean ops rather than SVGLoader's `pointsToStroke`,
 * which returns a BufferGeometry of stroke triangles and so cannot feed
 * ExtrudeGeometry at all.
 *
 * EXACT for round joins and caps — which is what Lucide/Feather/Heroicons all
 * specify — because a round-joined stroke's outline IS the union of a rectangle
 * per segment and a disc at every vertex. Miter and bevel joins are
 * approximated as round, so a sharp-cornered stroked logo loses its points;
 * accepted v1 limitation. Dasharray is ignored: a dashed stroke outlines solid.
 */
export async function outlineStrokes(paths: SvgLeafPath[]): Promise<SvgLeafPath[]> {
  // Same guard as svgToLeafPaths: paper.js touches browser globals at import
  // time, so calling this during SSR (e.g. a component setup() that runs
  // server-side) would throw an unhandled rejection instead of degrading to [].
  if (!paths.length || typeof window === 'undefined') return []
  const sc = await paperScope()
  const out: SvgLeafPath[] = []
  try {
    for (const p of paths) {
      const hasFill = p.fill !== 'none'
      const hasStroke = p.stroke !== 'none' && p.strokeWidth > 0
      if (hasFill) { out.push(p); continue }
      if (!hasStroke) continue // nothing to draw and nothing to extrude

      let united: PaperPathItem | null = null
      try {
        const src = new sc.CompoundPath(p.d)
        const r = p.strokeWidth / 2

        // `segments` are ANCHORS only, so uniting straight from them outlines a
        // curve as the polygon through its anchors — an expanded <circle> has
        // four anchors and would come out a rounded square. Flatten first, to a
        // tolerance taken from the shape's own size: `d` is in normalized import
        // space, which is a canvas fraction (~0.6) for the Compositor and a
        // scene size for 3D Studio, so any absolute tolerance would be wildly
        // wrong for one of them.
        const span = Math.max(src.bounds?.width || 0, src.bounds?.height || 0)
        const tol = span > 0 ? span / 400 : 0

        // `src.children` is empty only for a degenerate/empty CompoundPath (no
        // subpaths parsed from `p.d`) — there is no geometry to walk. The old
        // `[src]` fallback treated the CompoundPath itself as a Path, whose
        // `.segments` is undefined, and silently relied on the outer catch to
        // drop the stroke; skip it explicitly instead so a real bug in the
        // walk below isn't masked by the same catch.
        const children = (src.children ?? []) as PaperPath[]
        for (const child of children) {
          // Flatten a CLONE: paper's flatten is destructive, and `src` still
          // owns the geometry the loop is walking.
          const flat = child.clone({ insert: false }) as PaperPath
          if (tol > 0) flat.flatten(tol)
          const pts = flat.segments.map((s: any) => s.point)
          const closed = flat.closed
          flat.remove()
          if (closed && pts.length) pts.push(pts[0]!)
          for (let i = 0; i < pts.length; i++) {
            // A disc at every vertex — this is the join/cap, and it is why round
            // joins come out exact. `insert: false` keeps this intermediate out
            // of the project (only the final `united` needs to be there, and it
            // never is either — see the push below), so repeated imports don't
            // accumulate stale geometry that would pollute the next import's
            // whole-drawing bounds.
            const dot = new sc.Path.Circle({ center: pts[i]!, radius: r, insert: false })
            united = united ? (united.unite(dot, { insert: false }) as PaperPathItem) : dot
            if (i + 1 >= pts.length) continue
            // A rectangle spanning this segment, rotated onto it.
            const a = pts[i]!, b = pts[i + 1]!
            const len = a.getDistance(b)
            if (len < 1e-9) continue
            const rect = new sc.Path.Rectangle({ rectangle: new sc.Rectangle(0, -r, len, r * 2), insert: false })
            rect.rotate((b.subtract(a)).angle, new sc.Point(0, 0))
            rect.translate(a)
            united = united.unite(rect, { insert: false }) as PaperPathItem
          }
        }
        src.remove()
      } catch (err) {
        console.error('[useVectorSvg] stroke outline failed:', err)
        united = null
      }
      if (!united) continue
      const d = united.getPathData(undefined, 4)
      united.remove()
      // A degenerate stroke (e.g. every segment under the 1e-9 length guard)
      // can unite to nothing; matches svgToLeafPaths's `if (!d) continue`
      // guard so a `d: ''` entry never reaches a consumer expecting a drawable path.
      if (!d) continue
      out.push({
        d,
        fill: p.stroke,          // the stroke's colour becomes the solid's colour
        stroke: 'none',
        strokeWidth: 0,
        fillRule: 'nonzero',
      })
    }
  } finally {
    // Clear on EVERY exit path, throws included: the PaperScope is cached for
    // the life of the tab, so leftovers would accumulate across imports and
    // pollute the next import's whole-drawing bounds.
    sc.project.clear()
  }
  return out
}

/**
 * Parse an SVG string into one or more PathLayers (one per leaf path, so
 * per-shape fills/strokes are preserved). Returns [] if nothing usable.
 *
 * A thin mapping over `svgToLeafPaths` — the parsing, normalization and
 * coordinate contract all live there now, shared with 3D Studio's importer.
 */
export async function svgToPathLayers(svg: string, opts: ImportOpts = {}): Promise<PathLayer[]> {
  const { paths, bbox } = await svgToLeafPaths(svg, { targetWidth: opts.targetWidth ?? 0.6 })
  const cx = opts.cx ?? 0.5
  const cy = opts.cy ?? 0.5
  return paths.map((p) => createPathLayer({
    d: p.d, bbox: { ...bbox }, scale: 1, x: cx, y: cy,
    fill: p.fill, fillRule: p.fillRule, stroke: p.stroke, strokeWidth: p.strokeWidth,
  }))
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
    const strokeCol = paintToSvg(l.stroke).color
    const strokeAttr = strokeCol !== 'none' && l.strokeWidth > 0
      ? ` stroke="${strokeCol}" stroke-width="${(l.strokeWidth * s).toFixed(3)}"` : ''
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
  // Gradient/Fill fall back to a representative colour for v1 export (defs/patterns TBD).
  return { color: esc(paintPrimaryColor(p, '#000000')), opacityAttr: '' }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
