import { autoSmoothStops, type LoftStop } from './loftStops'
import * as THREE from 'three'
import { parseFills, fillPrimary } from './fills'

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Station { pos: Vec3; normal: Vec3; binormal: Vec3; t: number }
export interface StopProps { width: number; height: number; roll: number }

/** An editor-space point: x/y in 0..1, z in -1..1 — same coordinate space as `LoftStop`, but
 *  bezier control points are derived points, not stops. */
interface Ed { x: number; y: number; z: number }

// Map an editor-space point into a centred world point. The engine's camera frames roughly ±4
// units, so scale to that. y is flipped: canvas y-down → world y-up.
function worldFromEditor(e: Ed): Vec3 {
  return { x: (e.x - 0.5) * 8, y: (0.5 - e.y) * 8, z: e.z * 4 }
}

function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

// Control points for the editor-space cubic bezier segment s→e, built from each stop's tangent
// handles (angle `ta` + forward/backward handle lengths `hlf`/`hlb`). Missing fields default to a
// zero-length handle, which degenerates the segment to a straight line — safe for legacy stops.
function segEditor(s: LoftStop, e: LoftStop): { p1: Ed; p2: Ed } {
  const taS = s.ta ?? 0, hlfS = s.hlf ?? 0
  const taE = e.ta ?? 0, hlbE = e.hlb ?? 0
  return {
    p1: { x: s.x + Math.cos(taS) * hlfS, y: s.y + Math.sin(taS) * hlfS, z: s.z },
    p2: { x: e.x - Math.cos(taE) * hlbE, y: e.y - Math.sin(taE) * hlbE, z: e.z },
  }
}

// Evaluate the piecewise bezier at overall parameter `u` ∈ roughly [0,1] (may run slightly past
// the ends — callers probe `u+0.001` past the last station to get an "ahead" tangent sample; that
// overshoot extrapolates the last/first segment's cubic rather than snapping to a duplicate
// point, so the tangent stays meaningful right at the endpoints).
function posAtU(sm: LoftStop[], n: number, seg: number, closed: boolean, u: number): Ed {
  const f = u * seg
  let i = Math.floor(f)
  let local = f - i
  if (closed) {
    i = ((i % n) + n) % n
  } else if (i < 0) {
    i = 0; local = 0
  } else if (i > seg - 1) {
    local = local + (i - (seg - 1)); i = seg - 1
  }
  const a = sm[i]!, b = sm[(i + 1) % n]!
  const { p1, p2 } = segEditor(a, b)
  return {
    x: bez(a.x, p1.x, p2.x, b.x, local),
    y: bez(a.y, p1.y, p2.y, b.y, local),
    z: bez(a.z, p1.z, p2.z, b.z, local),
  }
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l } }

export function sampleSpine(stops: LoftStop[], closed: boolean, count: number): Station[] {
  // Auto-smooth non-manual stops into Catmull-Rom-equivalent tangent handles; manual stops keep
  // theirs. A single stop has no segment to sample, so duplicate it (tiny offset) like before.
  let raw = stops
  if (raw.length === 1) raw = [raw[0]!, { ...raw[0]!, id: `${raw[0]!.id}_dup`, x: raw[0]!.x + 0.001 }]
  const sm = autoSmoothStops(raw)
  const n = sm.length
  const seg = closed ? n : n - 1
  const stations: Station[] = []
  // Parallel-transport frame: seed a reference "up", rotate it minimally along the curve so the
  // profile doesn't spin wildly at inflections (a plain Frenet frame flips at zero curvature).
  let ref: Vec3 = { x: 0, y: 1, z: 0 }
  let prevTangent: Vec3 = { x: 1, y: 0, z: 0 }
  const denom = count > 1 ? count - 1 : 1
  for (let i = 0; i < count; i++) {
    const t = i / denom
    const u = closed ? (i / count) : t
    const pos = worldFromEditor(posAtU(sm, n, seg, closed, u))
    const ahead = worldFromEditor(posAtU(sm, n, seg, closed, u + 0.001))
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
  return { width: l('width'), height: l('height'), roll: l('roll') }
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

export interface LoftGeometry { positions: Float32Array; along: Float32Array; across: Float32Array; indices: Uint32Array }

/** Position of a UNIT cross-section point `v` (before width/height/roll scaling) projected onto
 *  the gradient axis (cosA,sinA), normalised to [0,1] and clamped. Drives colour-across (aAcross). */
function acrossCoord(v: Vec2, cosA: number, sinA: number): number {
  const p = (v.x * cosA + v.y * sinA + 1) / 2
  return p < 0 ? 0 : p > 1 ? 1 : p
}

/** Expand a closed 2D contour (already width/height-scaled + rolled, in the station's
 *  normal/binormal plane) into inner/outer edge points offset by ±halfWidth along each
 *  point's in-plane normal (perpendicular to the local outline direction). Returns 2·P
 *  points as [inner0, outer0, inner1, outer1, …]. Corner artifacts at very sharp concave
 *  vertices are accepted for v1. */
function ribbonEdges(pts2d: Vec2[], halfWidth: number): Vec2[] {
  const P = pts2d.length, out: Vec2[] = []
  for (let k = 0; k < P; k++) {
    const prev = pts2d[(k - 1 + P) % P]!, next = pts2d[(k + 1) % P]!
    const dx = next.x - prev.x, dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len                   // in-plane normal
    const p = pts2d[k]!
    out.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth })   // inner
    out.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth })   // outer
  }
  return out
}

/** Scaled+rolled 2D contour point for cross-section vertex `v` at a station's props — the
 *  same lx/ly + roll math the fill/cap ring loop uses, factored so the stroke ribbon path
 *  can share it. */
function rolledPoint2D(v: Vec2, pr: StopProps, cr: number, sr: number): Vec2 {
  const lx = v.x * pr.width, ly = v.y * pr.height
  return { x: lx * cr - ly * sr, y: lx * sr + ly * cr }
}

/** Place a 2D point (in the station's normal/binormal plane) into 3D world space. */
function place2D(st: Station, q: Vec2): Vec3 {
  return {
    x: st.pos.x + q.x * st.normal.x + q.y * st.binormal.x,
    y: st.pos.y + q.x * st.normal.y + q.y * st.binormal.y,
    z: st.pos.z + q.x * st.normal.z + q.y * st.binormal.z,
  }
}

export function buildLoftGeometry(opts: {
  stations: Station[]
  props: StopProps[]
  baseContours: Vec2[][]
  closed: boolean
  render: 'stroke' | 'fill'
  cap?: boolean
  strokeWidth?: number
  gradientAngle?: number
}): LoftGeometry {
  const { stations, props, baseContours, closed, render } = opts
  const K = stations.length
  const C = baseContours.length
  const P = C > 0 ? baseContours[0]!.length : 0
  const strokeWidth = opts.strokeWidth ?? 0
  const gradientAngle = opts.gradientAngle ?? 90
  const aRad = gradientAngle * Math.PI / 180
  const cosA = Math.cos(aRad), sinA = Math.sin(aRad)

  if (render === 'stroke' && strokeWidth > 0) {
    // Ribbon: 2 vertices (inner, outer) per contour point per ring.
    const positions = new Float32Array(K * C * P * 2 * 3)
    const along = new Float32Array(K * C * P * 2)
    const across = new Float32Array(K * C * P * 2)
    const ridx = (i: number, c: number, p: number, side: 0 | 1) => (((i * C + c) * P + p) * 2 + side)
    const halfWidth = strokeWidth / 2
    for (let i = 0; i < K; i++) {
      const st = stations[i]!, pr = props[i]!
      const cr = Math.cos((pr.roll * Math.PI) / 180), sr = Math.sin((pr.roll * Math.PI) / 180)
      for (let c = 0; c < C; c++) {
        const contour = baseContours[c]!
        const pts2d = contour.map(v => rolledPoint2D(v, pr, cr, sr))
        const edges = ribbonEdges(pts2d, halfWidth)   // [inner0, outer0, inner1, outer1, ...]
        for (let p = 0; p < P; p++) {
          const v = contour[p]!    // original UNIT contour point (pre width/height/roll)
          const inner = edges[p * 2]!, outer = edges[p * 2 + 1]!
          const wIn = place2D(st, inner), wOut = place2D(st, outer)
          const oi = ridx(i, c, p, 0), oo = ridx(i, c, p, 1)
          positions[oi * 3] = wIn.x; positions[oi * 3 + 1] = wIn.y; positions[oi * 3 + 2] = wIn.z
          positions[oo * 3] = wOut.x; positions[oo * 3 + 1] = wOut.y; positions[oo * 3 + 2] = wOut.z
          along[oi] = st.t; along[oo] = st.t
          across[oi] = acrossCoord(v, cosA, sinA); across[oo] = acrossCoord(v, cosA, sinA)
        }
      }
    }
    const indices: number[] = []
    for (let i = 0; i < K; i++) {
      for (let c = 0; c < C; c++) {
        for (let p = 0; p < P; p++) {
          const np = (p + 1) % P
          const a = ridx(i, c, p, 0), b = ridx(i, c, p, 1), d = ridx(i, c, np, 0), e = ridx(i, c, np, 1)
          // quad (inner_k, outer_k, outer_{k+1}, inner_{k+1}) → two triangles
          indices.push(a, b, e, a, e, d)
        }
      }
    }
    return { positions, along, across, indices: new Uint32Array(indices) }
  }

  const positions = new Float32Array(K * C * P * 3)
  const along = new Float32Array(K * C * P)
  const across = new Float32Array(K * C * P)
  const idx = (i: number, c: number, p: number) => (i * C + c) * P + p

  for (let i = 0; i < K; i++) {
    const st = stations[i]!, pr = props[i]!
    const cr = Math.cos((pr.roll * Math.PI) / 180), sr = Math.sin((pr.roll * Math.PI) / 180)
    for (let c = 0; c < C; c++) {
      const contour = baseContours[c]!
      for (let p = 0; p < P; p++) {
        const v = contour[p]!
        const q = rolledPoint2D(v, pr, cr, sr)
        const w = place2D(st, q)
        const o = idx(i, c, p)
        positions[o * 3] = w.x; positions[o * 3 + 1] = w.y; positions[o * 3 + 2] = w.z
        along[o] = st.t
        across[o] = acrossCoord(v, cosA, sinA)
      }
    }
  }

  let indices: number[] = []
  if (render === 'fill') {
    const lastRing = closed ? K : K - 1
    for (let i = 0; i < lastRing; i++) {
      const ni = (i + 1) % K
      for (let c = 0; c < C; c++) {
        for (let p = 0; p < P; p++) {
          const np = (p + 1) % P
          const a = idx(i, c, p), b = idx(i, c, np), d = idx(ni, c, p), e = idx(ni, c, np)
          indices.push(a, b, e, a, e, d)          // two triangles per quad
        }
      }
    }
  } else {
    // stroke: close each station's contour loop with line segments
    for (let i = 0; i < K; i++) {
      for (let c = 0; c < C; c++) {
        for (let p = 0; p < P; p++) {
          const np = (p + 1) % P
          indices.push(idx(i, c, p), idx(i, c, np))
        }
      }
    }
  }

  // Cap the two open ends of the swept surface with a centroid-fan disc so Fill mode reads as a
  // solid, not a hollow tube — closed loops have no ends to cap.
  if (render === 'fill' && opts.cap && !closed) {
    const capStations = [0, K - 1]
    const extraPos: number[] = [], extraAlong: number[] = [], extraAcross: number[] = []
    let capVo = K * C * P                       // next vertex index after the grid
    for (const i of capStations) {
      const st = stations[i]!
      for (let c = 0; c < C; c++) {
        const cIdx = capVo++
        extraPos.push(st.pos.x, st.pos.y, st.pos.z); extraAlong.push(st.t); extraAcross.push(0.5)
        for (let p = 0; p < P; p++) { const np = (p + 1) % P; indices.push(cIdx, idx(i, c, p), idx(i, c, np)) }
      }
    }
    if (extraPos.length) {
      const mergedPos = new Float32Array(positions.length + extraPos.length)
      mergedPos.set(positions); mergedPos.set(extraPos, positions.length)
      const mergedAlong = new Float32Array(along.length + extraAlong.length)
      mergedAlong.set(along); mergedAlong.set(extraAlong, along.length)
      const mergedAcross = new Float32Array(across.length + extraAcross.length)
      mergedAcross.set(across); mergedAcross.set(extraAcross, across.length)
      return { positions: mergedPos, along: mergedAlong, across: mergedAcross, indices: new Uint32Array(indices) }
    }
  }
  return { positions, along, across, indices: new Uint32Array(indices) }
}

export type LoftShape = 'circle' | 'oval' | 'rectangle' | 'polygon' | 'star'
export interface ShapeParams { rectRadius: number; polySides: number; starDepth: number }

/** Perimeter of a rounded rectangle in the box [-1,1]², radius `r` (0..1 of the half-extent). */
function roundedRectPath(r: number): Vec2[] {
  const rr = Math.min(1, Math.max(0, r))
  const out: Vec2[] = []
  const ARC = 8
  // corners: (+x+y), (-x+y), (-x-y), (+x-y); centre of each corner arc is inset by rr
  const corners = [
    { cx: 1 - rr, cy: 1 - rr, a0: 0 },
    { cx: -1 + rr, cy: 1 - rr, a0: Math.PI / 2 },
    { cx: -1 + rr, cy: -1 + rr, a0: Math.PI },
    { cx: 1 - rr, cy: -1 + rr, a0: (3 * Math.PI) / 2 },
  ]
  for (const c of corners) {
    for (let i = 0; i <= ARC; i++) {
      const a = c.a0 + (i / ARC) * (Math.PI / 2)
      out.push({ x: c.cx + Math.cos(a) * rr, y: c.cy + Math.sin(a) * rr })
    }
  }
  return out
}

export function shapeContour(shape: LoftShape, params: ShapeParams, points: number): Vec2[] {
  switch (shape) {
    case 'circle':
    case 'oval': {
      const out: Vec2[] = []
      for (let i = 0; i < points; i++) { const a = (i / points) * Math.PI * 2; out.push({ x: Math.cos(a), y: Math.sin(a) }) }
      return out
    }
    case 'rectangle':
      return resampleContour(roundedRectPath(params.rectRadius), points)
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.round(params.polySides))
      const isStar = shape === 'star'
      const verts = isStar ? n * 2 : n
      const inner = isStar ? Math.max(0.05, 1 - Math.min(0.9, Math.max(0, params.starDepth))) : 1
      const raw: Vec2[] = []
      for (let i = 0; i < verts; i++) {
        const a = (i / verts) * Math.PI * 2 - Math.PI / 2
        const rad = isStar && i % 2 === 1 ? inner : 1
        raw.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad })
      }
      return resampleContour(raw, points)
    }
  }
}

export function buildSlicedLoftGeometry(opts: {
  stations: Station[]; props: StopProps[]; baseContours: Vec2[][]
  closed: boolean; render: 'stroke' | 'fill'; elements: number; spacing: number
  cap?: boolean; strokeWidth?: number; gradientAngle?: number
}): LoftGeometry {
  const { stations, props, baseContours, render, elements, spacing } = opts
  const K = stations.length
  const C = baseContours.length
  const P = C > 0 ? baseContours[0]!.length : 0
  const E = Math.max(1, Math.round(elements))
  const gap = Math.min(0.95, Math.max(0, spacing))
  const half = 0.5 * (1 - gap) / E
  const strokeWidth = opts.strokeWidth ?? 0
  const gradientAngle = opts.gradientAngle ?? 90
  const aRad = gradientAngle * Math.PI / 180
  const cosA = Math.cos(aRad), sinA = Math.sin(aRad)
  // Interpolate (not round) so two rings whose t's straddle a single station index still land at
  // distinct 3D positions — rounding collapses a band to zero thickness once `elements` reaches
  // the station count (K), since both t's then round to the same nearest station.
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
  const stationAt = (t: number): Station => {
    const f = clamp01(t) * (K - 1)
    const i = Math.min(K - 1, Math.floor(f))
    const j = Math.min(K - 1, i + 1)
    const a = f - i
    const sa = stations[i]!, sb = stations[j]!
    const lerp3 = (pa: Vec3, pb: Vec3): Vec3 => ({ x: pa.x + (pb.x - pa.x) * a, y: pa.y + (pb.y - pa.y) * a, z: pa.z + (pb.z - pa.z) * a })
    return { pos: lerp3(sa.pos, sb.pos), normal: norm(lerp3(sa.normal, sb.normal)), binormal: norm(lerp3(sa.binormal, sb.binormal)), t: sa.t + (sb.t - sa.t) * a }
  }
  const propsAt = (t: number): StopProps => {
    const f = clamp01(t) * (K - 1)
    const i = Math.min(K - 1, Math.floor(f))
    const j = Math.min(K - 1, i + 1)
    const a = f - i
    const pa = props[i]!, pb = props[j]!
    return { width: pa.width + (pb.width - pa.width) * a, height: pa.height + (pb.height - pa.height) * a, roll: pa.roll + (pb.roll - pa.roll) * a }
  }

  if (render === 'stroke' && strokeWidth > 0) {
    // Ribbon: one ring per band (as line mode), 2 vertices (inner, outer) per contour point.
    const halfWidth = strokeWidth / 2
    const positions = new Float32Array(E * C * P * 2 * 3)
    const along = new Float32Array(E * C * P * 2)
    const across = new Float32Array(E * C * P * 2)
    const ridx = (band: number, c: number, p: number, side: 0 | 1) => (((band * C + c) * P + p) * 2 + side)
    for (let i = 0; i < E; i++) {
      const tc = (i + 0.5) / E
      const st = stationAt(tc), pr = propsAt(tc)
      const cr = Math.cos((pr.roll * Math.PI) / 180), sr = Math.sin((pr.roll * Math.PI) / 180)
      for (let c = 0; c < C; c++) {
        const pts2d = baseContours[c]!.map(v => rolledPoint2D(v, pr, cr, sr))
        const edges = ribbonEdges(pts2d, halfWidth)
        for (let p = 0; p < P; p++) {
          const v = baseContours[c]![p]!    // original UNIT contour point (pre width/height/roll)
          const inner = edges[p * 2]!, outer = edges[p * 2 + 1]!
          const wIn = place2D(st, inner), wOut = place2D(st, outer)
          const oi = ridx(i, c, p, 0), oo = ridx(i, c, p, 1)
          positions[oi * 3] = wIn.x; positions[oi * 3 + 1] = wIn.y; positions[oi * 3 + 2] = wIn.z
          positions[oo * 3] = wOut.x; positions[oo * 3 + 1] = wOut.y; positions[oo * 3 + 2] = wOut.z
          along[oi] = tc; along[oo] = tc
          across[oi] = acrossCoord(v, cosA, sinA); across[oo] = acrossCoord(v, cosA, sinA)
        }
      }
    }
    const indices: number[] = []
    for (let i = 0; i < E; i++) for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
      const np = (p + 1) % P
      const a = ridx(i, c, p, 0), b = ridx(i, c, p, 1), d = ridx(i, c, np, 0), e = ridx(i, c, np, 1)
      indices.push(a, b, e, a, e, d)
    }
    return { positions, along, across, indices: new Uint32Array(indices) }
  }

  const ringsPerBand = render === 'fill' ? 2 : 1
  const nVerts = E * ringsPerBand * C * P
  const positions = new Float32Array(nVerts * 3)
  const along = new Float32Array(nVerts)
  const across = new Float32Array(nVerts)
  let vo = 0
  for (let i = 0; i < E; i++) {
    const tc = (i + 0.5) / E
    const ts = render === 'fill' ? [tc - half, tc + half] : [tc]
    for (const t of ts) {
      const st = stationAt(t), pr = propsAt(t)
      const cr = Math.cos((pr.roll*Math.PI)/180), sr = Math.sin((pr.roll*Math.PI)/180)
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        const v = baseContours[c]![p]!
        const q = rolledPoint2D(v, pr, cr, sr)
        const w = place2D(st, q)
        positions[vo*3] = w.x; positions[vo*3+1] = w.y; positions[vo*3+2] = w.z
        along[vo] = tc
        across[vo] = acrossCoord(v, cosA, sinA)
        vo++
      }
    }
  }
  const indices: number[] = []
  const idx = (band: number, ring: number, c: number, p: number) => ((band*ringsPerBand + ring)*C + c)*P + p
  if (render === 'fill') {
    for (let i = 0; i < E; i++) for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
      const np = (p+1)%P
      const a = idx(i,0,c,p), b = idx(i,0,c,np), d = idx(i,1,c,p), e = idx(i,1,c,np)
      indices.push(a,b,e, a,e,d)
    }
  } else {
    for (let i = 0; i < E; i++) for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
      const np = (p+1)%P
      indices.push(idx(i,0,c,p), idx(i,0,c,np))
    }
  }

  // Cap BOTH rings of every band with a centroid-fan disc so each slice reads as a solid puck,
  // not a hollow ring — every band has two open ends (it's a short skinned tube segment).
  if (render === 'fill' && opts.cap) {
    const extraPos: number[] = [], extraAlong: number[] = [], extraAcross: number[] = []
    let capVo = nVerts                          // next index after the band grid
    for (let i = 0; i < E; i++) {
      const tc = (i + 0.5) / E
      const ts = [tc - half, tc + half]
      for (let ring = 0; ring < ringsPerBand; ring++) {
        const st = stationAt(ts[ring]!)         // interpolated station (same helper the rings use)
        for (let c = 0; c < C; c++) {
          const cIdx = capVo++
          extraPos.push(st.pos.x, st.pos.y, st.pos.z); extraAlong.push(tc); extraAcross.push(0.5)
          for (let p = 0; p < P; p++) { const np = (p + 1) % P; indices.push(cIdx, idx(i, ring, c, p), idx(i, ring, c, np)) }
        }
      }
    }
    if (extraPos.length) {
      const mp = new Float32Array(positions.length + extraPos.length); mp.set(positions); mp.set(extraPos, positions.length)
      const ma = new Float32Array(along.length + extraAlong.length); ma.set(along); ma.set(extraAlong, along.length)
      const mc = new Float32Array(across.length + extraAcross.length); mc.set(across); mc.set(extraAcross, across.length)
      return { positions: mp, along: ma, across: mc, indices: new Uint32Array(indices) }
    }
  }
  return { positions, along, across, indices: new Uint32Array(indices) }
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const h = String(hex).replace('#', '').slice(0, 6).padEnd(6, '0')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** A 1-D colour ramp (size*4 RGBA) built from ALL fills in the shared fills list,
 *  spread evenly as colour stops. solid/pattern → 1 primary stop; gradient/ombre → 2 stops (a, b).
 *  `blend` mode interpolates stops smoothly; `steps` mode hard-bands (stop j owns t∈[j/M, (j+1)/M)). */
export function rampFromFill(three: typeof THREE, fillsJson: string, size: number, mode: 'blend' | 'steps' = 'blend'): Uint8ClampedArray {
  let fills: any[]
  try { fills = parseFills(fillsJson) } catch { fills = [] }
  const stops: [number, number, number][] = []
  for (const f of fills) {
    const type = String(f?.type)
    if ((type === 'gradient' || type === 'ombre') && f.a && f.b) {
      stops.push(hexToRgbTuple(f.a), hexToRgbTuple(f.b))
    } else {
      let c: [number, number, number]
      try { const col = fillPrimary(three, f); c = [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)] }
      catch { c = [136, 136, 136] }
      stops.push(c)
    }
  }
  if (stops.length === 0) stops.push([136, 136, 136])
  const M = stops.length
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0
    let rgb: [number, number, number]
    if (M === 1) rgb = stops[0]!
    else if (mode === 'steps') rgb = stops[Math.min(M - 1, Math.floor(t * M))]!
    else {
      const x = t * (M - 1), j0 = Math.min(M - 1, Math.floor(x)), j1 = Math.min(M - 1, j0 + 1), a = x - j0
      const c0 = stops[j0]!, c1 = stops[j1]!
      rgb = [c0[0] + (c1[0] - c0[0]) * a, c0[1] + (c1[1] - c0[1]) * a, c0[2] + (c1[2] - c0[2]) * a]
    }
    out[i * 4] = Math.round(rgb[0]); out[i * 4 + 1] = Math.round(rgb[1]); out[i * 4 + 2] = Math.round(rgb[2]); out[i * 4 + 3] = 255
  }
  return out
}

type RGB = [number, number, number]
function fillAcrossSampler(three: typeof THREE, fill: any): (u: number) => RGB {
  const type = String(fill?.type)
  if ((type === 'gradient' || type === 'ombre') && fill.a && fill.b) {
    const a = hexToRgbTuple(fill.a), b = hexToRgbTuple(fill.b)
    return (u) => [a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u, a[2] + (b[2]-a[2])*u]
  }
  let c: RGB
  try { const col = fillPrimary(three, fill); c = [col.r*255, col.g*255, col.b*255] } catch { c = [136,136,136] }
  return () => c
}

export function fillsAngle(fillsJson: string): number {
  let fills: any[]; try { fills = parseFills(fillsJson) } catch { return 90 }
  const g = fills.find(f => { const t = String(f?.type); return t === 'gradient' || t === 'ombre' })
  const a = g ? Number(g.angle) : NaN
  return Number.isFinite(a) ? a : 90
}

export function build2DFillRamp(three: typeof THREE, fillsJson: string, mode: 'blend' | 'steps', acrossSize: number, alongSize: number): Uint8ClampedArray {
  let fills: any[]; try { fills = parseFills(fillsJson) } catch { fills = [] }
  if (!fills.length) fills = [{ type: 'solid' }]
  const samplers = fills.map(f => fillAcrossSampler(three, f))
  const N = samplers.length
  const out = new Uint8ClampedArray(acrossSize * alongSize * 4)
  for (let vy = 0; vy < alongSize; vy++) {
    const v = alongSize > 1 ? vy / (alongSize - 1) : 0
    let lo: number, hi: number, f: number
    if (N === 1) { lo = 0; hi = 0; f = 0 }
    else if (mode === 'steps') { lo = hi = Math.min(N-1, Math.floor(v * N)); f = 0 }
    else { const x = v*(N-1); lo = Math.min(N-1, Math.floor(x)); hi = Math.min(N-1, lo+1); f = x - lo }
    const sLo = samplers[lo]!, sHi = samplers[hi]!
    for (let ux = 0; ux < acrossSize; ux++) {
      const u = acrossSize > 1 ? ux / (acrossSize - 1) : 0
      const cLo = sLo(u), cHi = sHi(u)
      const o = (vy * acrossSize + ux) * 4
      out[o]   = Math.round(cLo[0] + (cHi[0]-cLo[0])*f)
      out[o+1] = Math.round(cLo[1] + (cHi[1]-cLo[1])*f)
      out[o+2] = Math.round(cLo[2] + (cHi[2]-cLo[2])*f)
      out[o+3] = 255
    }
  }
  return out
}

/** Turn a 1-D along ramp (alongSize*4 RGBA) into a 2-D texture (acrossSize×alongSize) with each
 *  along pixel replicated across every column — used by the per-stop colour source. */
export function stretchAcross(ramp1d: Uint8ClampedArray, acrossSize: number): Uint8ClampedArray {
  const alongSize = ramp1d.length / 4
  const out = new Uint8ClampedArray(acrossSize * alongSize * 4)
  for (let vy = 0; vy < alongSize; vy++) {
    const s = vy*4
    for (let ux = 0; ux < acrossSize; ux++) {
      const o = (vy*acrossSize + ux)*4
      out[o] = ramp1d[s]!; out[o+1] = ramp1d[s+1]!; out[o+2] = ramp1d[s+2]!; out[o+3] = 255
    }
  }
  return out
}

