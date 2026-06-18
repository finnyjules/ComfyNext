/**
 * String effect path model (STG /string).
 *
 * A "string" is an ordered list of control points; consecutive points connect
 * with cubic béziers. Each point stores a position and a single tangent ANGLE
 * shared by two collinear handles whose lengths (`hl` forward, `althl` back) are
 * independent — exactly STG's Particle (particle.js:16–19).
 *
 * All coordinates are NORMALIZED to the render frame: x,y ∈ [0,1] (screen-style,
 * y down), hl/althl are fractions of the frame. The effect maps these to world
 * space so a drawn path bakes pixel-faithfully at any export resolution.
 *
 * Stored in params as ONE JSON string (like fillList/textList) so ParamValue
 * stays scalar.
 */

export interface PathPoint {
  x: number
  y: number
  /** Tangent angle (radians) shared by both handles. */
  a: number
  /** Forward handle length (normalized). */
  hl: number
  /** Back ("alt") handle length (normalized). */
  althl: number
}

export interface PathString {
  points: PathPoint[]
}

export interface StringPathDoc {
  strings: PathString[]
  /** Editor pen mode: 'auto' = click-to-smooth (handles auto-derived), 'manual' = drag handles. */
  mode?: 'auto' | 'manual'
  /** Auto-smooth curviness (0 = straight corners … 1 = very curvy). */
  tension?: number
}

export interface Vec2 { x: number; y: number }

/** Forward handle position (STG: cos(a)·hl + x). */
export function forwardHandle(p: PathPoint): Vec2 {
  return { x: p.x + Math.cos(p.a) * p.hl, y: p.y + Math.sin(p.a) * p.hl }
}

/** Back handle position (STG: −cos(a)·althl + x). */
export function backHandle(p: PathPoint): Vec2 {
  return { x: p.x - Math.cos(p.a) * p.althl, y: p.y - Math.sin(p.a) * p.althl }
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parsePoint(raw: unknown): PathPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.x == null || r.y == null) return null
  const hl = num(r.hl, 0.12)
  return {
    x: num(r.x, 0.5),
    y: num(r.y, 0.5),
    a: num(r.a, Math.PI),
    hl,
    althl: num(r.althl, hl),
  }
}

/** Default seed: one string of 3 points down the centre (STG sketch_string.js:124–126). */
export function defaultPath(): StringPathDoc {
  const mk = (y: number): PathPoint => ({ x: 0.5, y, a: Math.PI, hl: 0.18, althl: 0.18 })
  return { strings: [{ points: [mk(0.25), mk(0.5), mk(0.75)] }], mode: 'auto', tension: 0.5 }
}

/**
 * Auto-smooth: derive each point's tangent handles from its neighbours (Catmull-Rom →
 * Bézier), so a path drawn by clicking alone flows as a smooth spline through the points.
 * Pure: returns new points with recomputed (a, hl, althl); x,y untouched. `curviness`
 * 0 = straight corners, 1 = very curvy.
 *
 * The handle ANGLE is the tangent direction + π so that forwardHandle()/backHandle()
 * (which sit at ±a) land where sampleString's STG pairing expects: forward = P − T,
 * back = P + T (T = the symmetric tangent vector).
 */
export function autoSmooth(points: PathPoint[], curviness: number): PathPoint[] {
  const n = points.length
  if (n < 2) return points.map(p => ({ ...p }))
  const f = Math.max(0, curviness) * 0.5
  return points.map((p, i) => {
    let tx: number, ty: number
    if (i === 0) { tx = f * 2 * (points[1]!.x - p.x); ty = f * 2 * (points[1]!.y - p.y) }
    else if (i === n - 1) { tx = f * 2 * (p.x - points[i - 1]!.x); ty = f * 2 * (p.y - points[i - 1]!.y) }
    else { tx = f * (points[i + 1]!.x - points[i - 1]!.x); ty = f * (points[i + 1]!.y - points[i - 1]!.y) }
    const hl = Math.hypot(tx, ty)
    return { x: p.x, y: p.y, a: Math.atan2(ty, tx) + Math.PI, hl, althl: hl }
  })
}

/** Tolerant parse: accepts a JSON string or already-parsed object; garbage → defaultPath(). */
export function parsePath(raw: unknown): StringPathDoc {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return defaultPath() }
  }
  if (!obj || typeof obj !== 'object') return defaultPath()
  const strings = (obj as Record<string, unknown>).strings
  if (!Array.isArray(strings)) return defaultPath()
  const out: PathString[] = []
  for (const s of strings) {
    const pts = s && typeof s === 'object' ? (s as Record<string, unknown>).points : null
    if (!Array.isArray(pts)) continue
    const points = pts.map(parsePoint).filter((p): p is PathPoint => p != null)
    out.push({ points })
  }
  // A path with no usable strings is useless to draw — fall back to the seed.
  if (!out.some(s => s.points.length > 0)) return defaultPath()
  const result: StringPathDoc = { strings: out }
  const o = obj as Record<string, unknown>
  if (o.mode === 'auto' || o.mode === 'manual') result.mode = o.mode
  if (typeof o.tension === 'number' && Number.isFinite(o.tension)) result.tension = o.tension
  return result
}

export function serializePath(doc: StringPathDoc): string {
  return JSON.stringify(doc)
}
