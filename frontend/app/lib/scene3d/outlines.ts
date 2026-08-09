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
    // The cache stays keyed by the RAW value (this `url` argument) — a plain
    // path, or a `google:Family@weight` token. `fontSourceUrl` only comes into
    // play for the actual network fetch below, so `google:Inter` and
    // `google:Inter@700` are distinct cache entries, matching the distinct
    // geometries a weight change produces.
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
  const res = await fetch(fontSourceUrl(url))
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  return opentype.parse(buf) as Font
}

// ---------------------------------------------------------------------------
// Google Fonts scheme
//
// A font value is either a local path (`/fonts/X.otf`, served straight from
// public/) or a `google:Family` / `google:Family@weight` token. The token
// never touches the network directly — `fontSourceUrl` turns it into a call
// against our own server proxy (Task 1's `/api/scene3d/google-font-file`),
// which does the fonts.googleapis.com round-trip and hands back a raw,
// opentype-parseable TTF. Weight defaults server-side, so we omit the param
// entirely rather than hardcode 400 twice.
// ---------------------------------------------------------------------------

const GOOGLE_PREFIX = 'google:'

/** Split a `google:Family` / `google:Family@weight` value into its parts. */
export function parseGoogleFontValue(value: string): { family: string; weight?: number } | null {
  if (!value.startsWith(GOOGLE_PREFIX)) return null
  const rest = value.slice(GOOGLE_PREFIX.length)
  const at = rest.indexOf('@')
  const family = (at === -1 ? rest : rest.slice(0, at)).trim()
  if (!family) return null
  if (at === -1) return { family }

  // A malformed or empty weight suffix (`@abc`, bare trailing `@`) falls back
  // to "no weight" rather than failing outright — the family is still usable.
  const weightRaw = rest.slice(at + 1).trim()
  const weight = weightRaw === '' ? NaN : Number(weightRaw)
  return Number.isFinite(weight) ? { family, weight: Math.round(weight) } : { family }
}

/** A local path passes through untouched; a `google:` value hits our proxy. */
export function fontSourceUrl(value: string): string {
  const parsed = parseGoogleFontValue(value)
  if (parsed) {
    // css2 convention (matched server-side): spaces become `+`, not %20 — but
    // percent-encode everything else first so an arbitrary family string (e.g.
    // containing `&` or `#`) can't inject extra query params.
    const familyParam = encodeURIComponent(parsed.family).replace(/%20/g, '+')
    const weightParam = parsed.weight !== undefined ? `&weight=${parsed.weight}` : ''
    return `/api/scene3d/google-font-file?family=${familyParam}${weightParam}`
  }
  const local = parseLibraryFontValue(value)
  if (local) {
    const id = libraryFaceResolver?.(local.family, local.weight, local.italic)
    if (id) return `/api/library-font/${encodeURIComponent(id)}`
    return value // catalog not ready / unknown — let the fetch fail and fall back
  }
  return value
}

/** Human-readable label for a font value, for UI display. */
export function fontDisplayName(value: string): string {
  const parsed = parseGoogleFontValue(value)
  if (parsed) return parsed.family
  const local = parseLibraryFontValue(value)
  if (local) return local.family
  const known = AVAILABLE_FONTS.find((f) => f.url === value)
  if (known) return known.label
  // Unrecognised local url: fall back to the filename rather than the full path.
  return value.split('/').pop() || value
}

// ---------------------------------------------------------------------------
// Library fonts scheme
//
// `local:Family` / `local:Family@weight` / `local:Family@weightI` — the local
// licensed library. Like `google:`, the token never hits the network directly:
// a resolver installed by app/data/library-fonts.ts maps (family, weight,
// italic) to a stable face id, which fontSourceUrl turns into a call against
// /api/library-font/<id>. Kept as an injected resolver so this module stays
// free of the manifest import (and out of the embed bundle's network checks).
// ---------------------------------------------------------------------------

const LOCAL_PREFIX = 'local:'

type LibraryFaceResolver = (family: string, weight: number | undefined, italic: boolean | undefined) => string | null
let libraryFaceResolver: LibraryFaceResolver | null = null

/** Install the (family,weight,italic) → faceId resolver. */
export function setLibraryFaceResolver(fn: LibraryFaceResolver | null): void {
  libraryFaceResolver = fn
}

/** Split a `local:Family` / `local:Family@700` / `local:Family@700i` value. */
export function parseLibraryFontValue(value: string): { family: string; weight?: number; italic?: boolean } | null {
  if (!value.startsWith(LOCAL_PREFIX)) return null
  const rest = value.slice(LOCAL_PREFIX.length)
  const at = rest.indexOf('@')
  const family = (at === -1 ? rest : rest.slice(0, at)).trim()
  if (!family) return null
  if (at === -1) return { family }
  let spec = rest.slice(at + 1).trim()
  let italic: boolean | undefined
  if (/i$/i.test(spec)) { italic = true; spec = spec.slice(0, -1) }
  const weight = spec === '' ? NaN : Number(spec)
  const out: { family: string; weight?: number; italic?: boolean } = { family }
  if (Number.isFinite(weight)) out.weight = Math.round(weight)
  if (italic) out.italic = true
  return out
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

/**
 * Divisions per curve when flattening to measure the bounding box. The box is
 * only as accurate as this sampling, and a shape profile has few, large curves
 * (unlike a glyph's many small ones), so this needs to be generous — at 12 a
 * filleted polygon centred to only ~1e-4.
 */
const CENTRE_SAMPLES = 64

/** Recentre every shape (and its holes) on the combined bounding box. */
function centre(shapes: THREE.Shape[]): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of shapes) {
    for (const p of s.getPoints(CENTRE_SAMPLES)) {
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

export const SHAPE_MIN_SIDES = 3
export const SHAPE_MAX_SIDES = 24

/** Deepest a star point may cut, so `star: 1` stays a shape rather than a spike. */
const STAR_MAX_DEPTH = 0.9
/** Below this a fillet is treated as absent, keeping the polygon exactly N segments. */
const FILLET_EPS = 1e-9

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/**
 * A parametric 2D profile — a regular polygon, optionally starred and filleted.
 *
 * Fully deterministic: no RNG anywhere, so identical arguments always produce
 * an identical contour.
 *
 * - `sides` (3–24): polygon vertex count, first vertex pointing straight up.
 * - `roundness` (0–1): corner fillet. The fillet inset is
 *   `roundness × half the SHORTEST edge`, so at 1 the tangent points meet at
 *   the edge midpoints — as round as the polygon allows (a hexagon at 1
 *   approaches a circle) — and the contour can never self-intersect, because
 *   no edge is ever consumed by more than its own length.
 * - `star` (0–1): alternate vertices pull in toward the centre by this
 *   fraction, turning an N-gon into an N-pointed star. 0 leaves the plain
 *   polygon (and only N vertices at all).
 *
 * Wound counter-clockwise, so the signed area is positive and matches the
 * solid convention used by `textOutline`. Centred on its bounding box.
 */
export function shapeOutline(sides: number, roundness: number, star = 0): THREE.Shape[] {
  const n = Math.min(
    SHAPE_MAX_SIDES,
    Math.max(SHAPE_MIN_SIDES, Number.isFinite(sides) ? Math.round(sides) : SHAPE_MIN_SIDES),
  )
  const r = clamp01(roundness)
  const s = clamp01(star)

  // Vertices, CCW from straight up. A star interleaves an inner vertex between
  // every pair of outer ones, so it has 2n vertices; a plain polygon has n.
  const points: THREE.Vector2[] = []
  const starred = s > 0
  const count = starred ? n * 2 : n
  const innerRadius = 1 - s * STAR_MAX_DEPTH
  for (let i = 0; i < count; i++) {
    const angle = Math.PI / 2 + (i / count) * Math.PI * 2
    const radius = starred && i % 2 === 1 ? innerRadius : 1
    points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius))
  }

  // Fillet inset: half the shortest edge at roundness 1. Using the SHORTEST
  // edge globally is what guarantees 2·inset never exceeds any single edge.
  let shortestEdge = Infinity
  for (let i = 0; i < count; i++) {
    shortestEdge = Math.min(shortestEdge, points[i]!.distanceTo(points[(i + 1) % count]!))
  }
  const inset = r * 0.5 * shortestEdge

  const shape = new THREE.Shape()

  if (inset < FILLET_EPS) {
    // Sharp polygon: exactly `count` straight segments.
    shape.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < count; i++) shape.lineTo(points[i]!.x, points[i]!.y)
    shape.closePath()
  } else {
    // Per corner: walk in to the entry tangent, then arc across the corner via
    // a quadratic whose control point is the original vertex.
    const entry: THREE.Vector2[] = []
    const exit: THREE.Vector2[] = []
    for (let i = 0; i < count; i++) {
      const prev = points[(i - 1 + count) % count]!
      const cur = points[i]!
      const next = points[(i + 1) % count]!
      const inDir = new THREE.Vector2().subVectors(cur, prev).normalize()
      const outDir = new THREE.Vector2().subVectors(next, cur).normalize()
      entry.push(new THREE.Vector2().copy(cur).addScaledVector(inDir, -inset))
      exit.push(new THREE.Vector2().copy(cur).addScaledVector(outDir, inset))
    }

    shape.moveTo(exit[0]!.x, exit[0]!.y)
    for (let k = 1; k <= count; k++) {
      const i = k % count
      const from = exit[(i - 1 + count) % count]!
      // At roundness 1 the tangent points coincide, so skip the null segment
      // rather than emitting a zero-length curve for the triangulator.
      if (from.distanceTo(entry[i]!) > FILLET_EPS) shape.lineTo(entry[i]!.x, entry[i]!.y)
      shape.quadraticCurveTo(points[i]!.x, points[i]!.y, exit[i]!.x, exit[i]!.y)
    }
    shape.closePath()
  }

  const shapes = [shape]
  centre(shapes)
  return shapes
}
