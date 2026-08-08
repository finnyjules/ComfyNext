import type { LoftStop } from './loftStops'

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Station { pos: Vec3; normal: Vec3; binormal: Vec3; t: number }
export interface StopProps { width: number; height: number; radius: number; sides: number; roll: number }

// Map an editor-space stop (x,y in 0..1, z in -1..1) into a centred world point. The engine's
// camera frames roughly ±4 units, so scale to that. y is flipped: canvas y-down → world y-up.
function stopToWorld(s: LoftStop): Vec3 {
  return { x: (s.x - 0.5) * 8, y: (0.5 - s.y) * 8, z: s.z * 4 }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function sampleCurve(pts: Vec3[], closed: boolean, u: number): Vec3 {
  // u in [0,1] over the whole polyline of control points
  const n = pts.length
  const seg = closed ? n : n - 1
  const f = u * seg
  let i = Math.floor(f)
  const local = f - i
  const idx = (k: number) => closed ? ((k % n) + n) % n : Math.min(Math.max(k, 0), n - 1)
  const P0 = pts[idx(i - 1)]!, P1 = pts[idx(i)]!, P2 = pts[idx(i + 1)]!, P3 = pts[idx(i + 2)]!
  return {
    x: catmullRom(P0.x, P1.x, P2.x, P3.x, local),
    y: catmullRom(P0.y, P1.y, P2.y, P3.y, local),
    z: catmullRom(P0.z, P1.z, P2.z, P3.z, local),
  }
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l } }

export function sampleSpine(stops: LoftStop[], closed: boolean, count: number): Station[] {
  const pts = stops.map(stopToWorld)
  if (pts.length === 1) pts.push({ ...pts[0]!, x: pts[0]!.x + 0.001 })
  const stations: Station[] = []
  // Parallel-transport frame: seed a reference "up", rotate it minimally along the curve so the
  // profile doesn't spin wildly at inflections (a plain Frenet frame flips at zero curvature).
  let ref: Vec3 = { x: 0, y: 1, z: 0 }
  let prevTangent: Vec3 = { x: 1, y: 0, z: 0 }
  const denom = count > 1 ? count - 1 : 1
  for (let i = 0; i < count; i++) {
    const t = i / denom
    const pos = sampleCurve(pts, closed, closed ? (i / count) : t)
    const ahead = sampleCurve(pts, closed, (closed ? (i / count) : t) + 0.001)
    const rawT = sub(ahead, pos)
    const tlen = Math.hypot(rawT.x, rawT.y, rawT.z)
    const tangent = tlen < 1e-6 ? prevTangent : norm(rawT)
    prevTangent = tangent
    // project ref perpendicular to tangent
    const dot = ref.x * tangent.x + ref.y * tangent.y + ref.z * tangent.z
    let normal = norm({ x: ref.x - tangent.x * dot, y: ref.y - tangent.y * dot, z: ref.z - tangent.z * dot })
    if (!Number.isFinite(normal.x)) normal = { x: 1, y: 0, z: 0 }
    const binormal = norm(cross(tangent, normal))
    ref = normal   // carry forward for minimal twist
    stations.push({ pos, normal, binormal, t })
  }
  return stations
}

// Locate t within the stop list and lerp field `k`.
function bracket(stops: LoftStop[], t: number): { a: LoftStop; b: LoftStop; f: number } {
  const n = stops.length
  if (n === 1) return { a: stops[0]!, b: stops[0]!, f: 0 }
  const x = Math.min(1, Math.max(0, t)) * (n - 1)
  const i = Math.min(Math.floor(x), n - 2)
  return { a: stops[i]!, b: stops[i + 1]!, f: x - i }
}

export function interpStopProps(stops: LoftStop[], t: number): StopProps {
  const { a, b, f } = bracket(stops, t)
  const l = (p: keyof StopProps) => (a[p as keyof LoftStop] as number) + ((b[p as keyof LoftStop] as number) - (a[p as keyof LoftStop] as number)) * f
  return { width: l('width'), height: l('height'), radius: l('radius'), sides: l('sides'), roll: l('roll') }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

export function interpStopColor(stops: LoftStop[], t: number): [number, number, number] {
  const { a, b, f } = bracket(stops, t)
  const ca = hexToRgb(a.color), cb = hexToRgb(b.color)
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]
}

export function buildRamp(stops: LoftStop[], size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const [r, g, b] = interpStopColor(stops, size > 1 ? i / (size - 1) : 0)
    out[i * 4] = Math.round(r * 255); out[i * 4 + 1] = Math.round(g * 255); out[i * 4 + 2] = Math.round(b * 255); out[i * 4 + 3] = 255
  }
  return out
}

// A superellipse-ish rounded profile in unit space. `sides` chooses the corner sharpness
// exponent (low → polygonal, high → smooth ellipse); `radius` blends between a rect (0) and the
// rounded form (1). width/height are applied later per-station, so this is unit-normalised.
export function parametricProfileContour(p: StopProps, points: number): Vec2[] {
  const sides = Math.max(3, Math.round(p.sides))
  const n = Math.pow(2, 1 + (sides / 64) * 5)   // exponent 2..~64 → superellipse sharpness
  const out: Vec2[] = []
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a)
    // superellipse: |x|^n + |y|^n = 1
    const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n)
    const ey = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n)
    // radius blends the sharp unit box (cos/sin scaled to box) with the superellipse
    const bx = ca / Math.max(Math.abs(ca), Math.abs(sa) || 1e-6)
    const by = sa / Math.max(Math.abs(ca), Math.abs(sa) || 1e-6)
    out.push({ x: bx + (ex - bx) * p.radius, y: by + (ey - by) * p.radius })
  }
  return out
}

export function resampleContour(pts: Vec2[], points: number): Vec2[] {
  if (pts.length === 0) return []
  // cumulative arc length around the closed loop
  const cum: number[] = [0]
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i % pts.length]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[cum.length - 1]! || 1
  const out: Vec2[] = []
  for (let i = 0; i < points; i++) {
    const target = (i / points) * total
    let seg = 1
    while (seg < cum.length && cum[seg]! < target) seg++
    const a = pts[(seg - 1) % pts.length]!, b = pts[seg % pts.length]!
    const segLen = (cum[seg]! - cum[seg - 1]!) || 1
    const f = (target - cum[seg - 1]!) / segLen
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return out
}
