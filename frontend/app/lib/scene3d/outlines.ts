/**
 * 2D outline sources for the extruded `text` and `shape` primitives.
 *
 * Both produce `THREE.Shape[]`, which `geometryFor` feeds straight to
 * `ExtrudeGeometry` — so everything downstream (materials, modifiers, cloner,
 * Size, export) treats them as ordinary geometry.
 *
 * The font parser is the opentype build vendored inside three itself
 * (`three/examples/jsm/libs/opentype.module.js`, used by three's own
 * TTFLoader). three is already a dependency, so this adds nothing new — and
 * it handles the CFF/PostScript outlines our .otf files actually use.
 */
import * as THREE from 'three'
// @ts-expect-error — three vendors this lib without type declarations.
import opentype from 'three/examples/jsm/libs/opentype.module.js'

import { DEFAULT_CONFIG } from '~/lib/shapefx/config'
import { gemPoints } from '~/lib/shapefx/points'

// ---------------------------------------------------------------------------
// Types
//
// The vendored opentype ships no .d.ts, so we describe the slice we use. Only
// these members are touched anywhere in the 3D Studio.
// ---------------------------------------------------------------------------

export interface PathCommand {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z'
  x?: number
  y?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

export interface Font {
  unitsPerEm: number
  names?: { fullName?: Record<string, string> }
  getPath(text: string, x: number, y: number, size: number): { commands: PathCommand[] }
  getAdvanceWidth(text: string, size: number): number
}

// ---------------------------------------------------------------------------
// Font catalogue
//
// Derived from what actually sits in `frontend/public/fonts`. public/ is served
// at the site root, so the URL is the path below `public/`.
// ---------------------------------------------------------------------------

export const AVAILABLE_FONTS: { label: string; url: string }[] = [
  { label: 'ABC ROM Bold', url: '/fonts/ABCROM-Bold.otf' },
  { label: 'ABC ROM Black Italic', url: '/fonts/ABCROM-BlackItalic.otf' },
  { label: 'ABC ROM Heavy Italic', url: '/fonts/ABCROM-HeavyItalic.otf' },
  { label: 'Neue Montreal Hairline', url: '/fonts/NeueMontreal/PPNeueMontreal-Hairline.otf' },
  { label: 'Neue Montreal Light', url: '/fonts/NeueMontreal/PPNeueMontreal-Light.otf' },
  { label: 'Neue Montreal Book', url: '/fonts/NeueMontreal/PPNeueMontreal-Book.otf' },
  { label: 'Neue Montreal Regular', url: '/fonts/NeueMontreal/PPNeueMontreal-Regular.otf' },
  { label: 'Neue Montreal Medium', url: '/fonts/NeueMontreal/PPNeueMontreal-Medium.otf' },
  { label: 'Neue Montreal Semibold', url: '/fonts/NeueMontreal/PPNeueMontreal-Semibold.otf' },
  { label: 'Neue Montreal Extrabold', url: '/fonts/NeueMontreal/PPNeueMontreal-Extrabold.otf' },
  { label: 'Neue Montreal Black', url: '/fonts/NeueMontreal/PPNeueMontreal-Black.otf' },
  { label: 'Neue Montreal Italic', url: '/fonts/NeueMontreal/PPNeueMontreal-Italic.otf' },
  { label: 'Neue Montreal Black Italic', url: '/fonts/NeueMontreal/PPNeueMontreal-BlackItalic.otf' },
  { label: 'Neue Montreal Text Light', url: '/fonts/NeueMontreal/PPNeueMontrealText-Light.otf' },
  { label: 'Neue Montreal Text Book', url: '/fonts/NeueMontreal/PPNeueMontrealText-Book.otf' },
  { label: 'Neue Montreal Text Bold', url: '/fonts/NeueMontreal/PPNeueMontrealText-Bold.otf' },
]

// ---------------------------------------------------------------------------
// Font loading — mirrors the glb.ts cache contract exactly.
// ---------------------------------------------------------------------------

const pending = new Map<string, Promise<Font>>()
/** Resolved fonts, so `geometryFor` can peek synchronously. */
const resolved = new Map<string, Font>()

export function loadFont(url: string): Promise<Font> {
  let p = pending.get(url)
  if (!p) {
    p = fetchAndParse(url)
    // Don't cache failures — a retry should actually retry.
    p.catch(() => pending.delete(url))
    p.then((f) => resolved.set(url, f)).catch(() => {})
    pending.set(url, p)
  }
  return p
}

/**
 * Synchronous peek at the cache. `geometryFor` must stay synchronous, so on a
 * miss it kicks off `loadFont` and draws a placeholder for one frame.
 */
export function fontCacheGet(url: string): Font | null {
  return resolved.get(url) ?? null
}

async function fetchAndParse(url: string): Promise<Font> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  return opentype.parse(buf) as Font
}

// ---------------------------------------------------------------------------
// Contour plumbing
// ---------------------------------------------------------------------------

interface Contour {
  path: THREE.Path
  /** Flattened points, used for signed area and containment tests. */
  points: THREE.Vector2[]
  area: number
}

/** Shoelace signed area. Positive = counter-clockwise in a y-up frame. */
function signedArea(points: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function pointInPolygon(pt: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    const straddles = a.y > pt.y !== b.y > pt.y
    if (straddles && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Walk opentype path commands into closed contours.
 *
 * Two coordinate facts drive this:
 *  - opentype is y-DOWN, three is y-UP, so y is negated here. Everything after
 *    this point (including the winding test) is in the flipped, y-up frame.
 *  - Negating y flips the sign of every signed area. Measured on the real
 *    fonts, opentype emits outer contours clockwise (negative area) in its own
 *    y-down space, so after the flip OUTER contours are POSITIVE and counters
 *    are NEGATIVE. That, not contour order, is what decides shape-vs-hole —
 *    a dotted 'i' has two outer contours and no hole at all.
 */
function commandsToContours(commands: PathCommand[], scale: number, dx: number): Contour[] {
  const out: Contour[] = []
  let path: THREE.Path | null = null
  let points: THREE.Vector2[] = []

  const X = (v: number) => v * scale + dx
  const Y = (v: number) => -v * scale

  const finish = () => {
    if (path && points.length >= 3) out.push({ path, points, area: signedArea(points) })
    path = null
    points = []
  }

  for (const c of commands) {
    switch (c.type) {
      case 'M': {
        finish()
        path = new THREE.Path()
        path.moveTo(X(c.x!), Y(c.y!))
        points = [new THREE.Vector2(X(c.x!), Y(c.y!))]
        break
      }
      case 'L': {
        if (!path) break
        path.lineTo(X(c.x!), Y(c.y!))
        points.push(new THREE.Vector2(X(c.x!), Y(c.y!)))
        break
      }
      case 'C': {
        if (!path) break
        path.bezierCurveTo(X(c.x1!), Y(c.y1!), X(c.x2!), Y(c.y2!), X(c.x!), Y(c.y!))
        sampleLast(path, points)
        break
      }
      case 'Q': {
        if (!path) break
        path.quadraticCurveTo(X(c.x1!), Y(c.y1!), X(c.x!), Y(c.y!))
        sampleLast(path, points)
        break
      }
      case 'Z': {
        if (path) path.closePath()
        finish()
        break
      }
    }
  }
  finish()
  return out
}

/** Flatten the curve just appended to `path` into `points` for the area test. */
function sampleLast(path: THREE.Path, points: THREE.Vector2[]): void {
  const curve = path.curves[path.curves.length - 1]
  if (!curve) return
  // Skip index 0 — it duplicates the previous point.
  for (const p of curve.getPoints(12).slice(1)) points.push(p)
}

/**
 * Turn a flat contour list into shapes, attaching every hole to the smallest
 * solid that contains it. Containment (rather than "same glyph") is what makes
 * multi-glyph strings work: 'oo' must put each counter on its own letter.
 */
function assemble(contours: Contour[]): THREE.Shape[] {
  const solids = contours.filter((c) => c.area > 0)
  const holes = contours.filter((c) => c.area < 0)

  // Degenerate fallback: if nothing read as solid, treat everything as solid
  // rather than emitting an empty result.
  const bases = solids.length ? solids : contours

  const shapes = bases.map((c) => {
    const s = new THREE.Shape()
    s.curves = c.path.curves.slice()
    s.autoClose = true
    return { shape: s, source: c }
  })

  if (solids.length) {
    for (const hole of holes) {
      const probe = hole.points[0]!
      let best: (typeof shapes)[number] | null = null
      for (const cand of shapes) {
        if (!pointInPolygon(probe, cand.source.points)) continue
        if (!best || Math.abs(cand.source.area) < Math.abs(best.source.area)) best = cand
      }
      const target = best ?? shapes[0]
      if (!target) continue
      const p = new THREE.Path()
      p.curves = hole.path.curves.slice()
      p.autoClose = true
      target.shape.holes.push(p)
    }
  }

  return shapes.map((s) => s.shape)
}

/** Recentre every shape (and its holes) on the combined bounding box. */
function centre(shapes: THREE.Shape[]): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of shapes) {
    for (const p of s.getPoints(12)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  if (cx === 0 && cy === 0) return
  for (const s of shapes) {
    translateCurves(s, -cx, -cy)
    for (const h of s.holes) translateCurves(h, -cx, -cy)
  }
}

const POINT_KEYS = ['v0', 'v1', 'v2', 'v3'] as const

function translateCurves(path: THREE.Path, dx: number, dy: number): void {
  for (const curve of path.curves) {
    const c = curve as unknown as Record<string, THREE.Vector2 | undefined>
    for (const k of POINT_KEYS) {
      const v = c[k]
      if (v) { v.x += dx; v.y += dy }
    }
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Set `text` in `font` and return its outline as extrudable shapes, centred on
 * the origin like every other primitive.
 *
 * `size` is the em size in scene units; `letterSpacing` is added to the pen
 * advance between glyphs, in the same units.
 */
export function textOutline(
  text: string,
  font: Font,
  opts: { size: number; letterSpacing: number },
): THREE.Shape[] {
  if (!font || !text) return []

  const size = Number.isFinite(opts.size) && opts.size > 0 ? opts.size : 1
  const letterSpacing = Number.isFinite(opts.letterSpacing) ? opts.letterSpacing : 0
  const scale = size / (font.unitsPerEm || 1000)

  const contours: Contour[] = []
  let pen = 0

  for (const glyph of Array.from(text)) {
    // getPath in font units (size = unitsPerEm), then scale ourselves so the
    // pen advance and the outline share one scale factor.
    const path = font.getPath(glyph, 0, 0, font.unitsPerEm)
    contours.push(...commandsToContours(path.commands, scale, pen))
    pen += font.getAdvanceWidth(glyph, font.unitsPerEm) * scale + letterSpacing
  }

  if (!contours.length) return []

  const shapes = assemble(contours)
  centre(shapes)
  return shapes
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

const SHAPE_MIN_SIDES = 3
const SHAPE_MAX_SIDES = 64

/**
 * A gem-style silhouette from Shape Studio's own point source.
 *
 * `gemPoints` returns a seeded 3D cloud; we read its XY as a radial profile —
 * sort the points by angle and lay one vertex per side around the circle, so
 * the outline has exactly `sides` segments and is deterministic in `sides`.
 *
 * `roundness` (0–1) blends each radius toward the mean, so 0 is a jagged gem
 * profile and 1 is a clean circle.
 */
export function shapeOutline(sides: number, roundness: number): THREE.Shape[] {
  const n = Math.min(
    SHAPE_MAX_SIDES,
    Math.max(SHAPE_MIN_SIDES, Number.isFinite(sides) ? Math.round(sides) : SHAPE_MIN_SIDES),
  )
  const r = Number.isFinite(roundness) ? Math.min(1, Math.max(0, roundness)) : 0

  const config = {
    ...DEFAULT_CONFIG,
    shape: { ...DEFAULT_CONFIG.shape, vertices: n },
  }
  const cloud = gemPoints(config)

  // Radial profile: one radius per side, taken from the cloud in angle order.
  const radii = cloud
    .map((p) => ({ angle: Math.atan2(p[1]!, p[0]!), radius: Math.hypot(p[0]!, p[1]!) }))
    .sort((a, b) => a.angle - b.angle)
    .map((p) => p.radius)

  // gemPoints clamps to 4..64, so pad or trim to exactly `n` samples.
  const samples: number[] = []
  for (let i = 0; i < n; i++) samples.push(radii[i % radii.length] ?? 1)

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length || 1
  const blended = samples.map((v) => (v + (mean - v) * r) / mean)

  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rad = blended[i]!
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()

  const shapes = [shape]
  centre(shapes)
  return shapes
}
