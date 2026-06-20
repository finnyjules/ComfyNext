export interface TunnelRingGeometry {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  /** Perimeter arc length of the ring centerline (world units). */
  perimeter: number
}

/** Outline shape of the ring centerline. */
export type TunnelShape = 'rect' | 'circle' | 'diamond'

export interface TunnelRingParams {
  /** Ring centerline half-extents (world units). */
  halfW: number
  halfH: number
  /** Band thickness across the frame = the type height (world units). */
  thickness: number
  /** Corner radius of the centerline (world units). Defaults to thickness/2 (→ sharp inner corners). Rect only. */
  cornerRadius?: number
  /** Outline shape (default 'rect'). 'circle' = ellipse to the half-extents, 'diamond' = rhombus. */
  shape?: TunnelShape
}

const HALF_PI = Math.PI / 2
const TWO_PI = Math.PI * 2

interface PathPoint { x: number; y: number; nx: number; ny: number }

/** Ellipse (a×b) centerline point at arc length `s`, CLOCKWISE, with the outward unit normal.
 *  Parameterised by angle (exact arc-length for a circle, near-uniform for an ellipse). */
export function ellipsePoint(s: number, perimeter: number, a: number, b: number): PathPoint {
  const th = (s / Math.max(1e-6, perimeter)) * TWO_PI
  const c = Math.cos(th), si = Math.sin(th)
  // Clockwise sweep: pos = (a·cosθ, −b·sinθ); outward normal ⟂ tangent, away from centre.
  let nx = b * c, ny = -a * si
  const l = Math.hypot(nx, ny) || 1
  return { x: a * c, y: -b * si, nx: nx / l, ny: ny / l }
}

/** Diamond (rhombus with vertices ±a/±b on the axes) centerline point at arc length `s`, CLOCKWISE
 *  from the top vertex, with the per-edge outward unit normal. Corners are sharp. */
export function diamondPoint(s: number, a: number, b: number): PathPoint {
  const L = Math.hypot(a, b), perim = 4 * L
  const ss = ((s % perim) + perim) % perim
  const edge = Math.min(3, Math.floor(ss / L))
  const t = (ss - edge * L) / L
  const verts: [number, number][] = [[0, b], [a, 0], [0, -b], [-a, 0]]   // CW from top
  const normals: [number, number][] = [[b, a], [b, -a], [-b, -a], [-b, a]]
  const v0 = verts[edge]!, v1 = verts[(edge + 1) % 4]!, nrm = normals[edge]!
  const nl = Math.hypot(nrm[0], nrm[1]) || 1
  return { x: v0[0] + (v1[0] - v0[0]) * t, y: v0[1] + (v1[1] - v0[1]) * t, nx: nrm[0] / nl, ny: nrm[1] / nl }
}

/**
 * A point on a rounded-rectangle centerline at arc length `s`, with the outward unit normal.
 * Traversed CLOCKWISE from the top edge: top → right → bottom → left, with quarter-circle corners.
 * `a`,`b` = half-extents, `r` = corner radius (r ≤ min(a,b)). Pure, unit-testable.
 */
export function roundedRectPoint(s: number, a: number, b: number, r: number): { x: number; y: number; nx: number; ny: number } {
  const sx = 2 * (a - r), sy = 2 * (b - r), arc = r * HALF_PI
  const segs = [sx, arc, sy, arc, sx, arc, sy, arc]
  const P = 2 * sx + 2 * sy + 4 * arc
  let rem = ((s % P) + P) % P
  for (let k = 0; k < segs.length; k++) {
    const len = segs[k]!
    if (rem <= len || k === segs.length - 1) {
      switch (k) {
        case 0: return { x: -(a - r) + rem, y: b, nx: 0, ny: 1 }                       // top edge (+x)
        case 1: { const ang = HALF_PI * (1 - rem / arc); return corner(a - r, b - r, r, ang) }   // TR arc 90°→0°
        case 2: return { x: a, y: (b - r) - rem, nx: 1, ny: 0 }                        // right edge (−y)
        case 3: { const ang = -HALF_PI * (rem / arc); return corner(a - r, -(b - r), r, ang) }    // BR arc 0°→−90°
        case 4: return { x: (a - r) - rem, y: -b, nx: 0, ny: -1 }                      // bottom edge (−x)
        case 5: { const ang = -HALF_PI - HALF_PI * (rem / arc); return corner(-(a - r), -(b - r), r, ang) } // BL −90°→−180°
        case 6: return { x: -a, y: -(b - r) + rem, nx: -1, ny: 0 }                     // left edge (+y)
        default: { const ang = -Math.PI - HALF_PI * (rem / arc); return corner(-(a - r), b - r, r, ang) }   // TL −180°→−270°
      }
    }
    rem -= len
  }
  return { x: -(a - r), y: b, nx: 0, ny: 1 } // unreachable
}

function corner(cx: number, cy: number, r: number, ang: number): { x: number; y: number; nx: number; ny: number } {
  const c = Math.cos(ang), s = Math.sin(ang)
  return { x: cx + r * c, y: cy + r * s, nx: c, ny: s }
}

/**
 * A flat text-frame ring (a "picture frame" of type) in the z=0 plane: the centerline is a rounded
 * rectangle / ellipse / diamond (per `shape`) and the band is swept ±thickness/2 along the outward
 * normal. uv.x runs 0→1 CLOCKWISE around the whole perimeter (so the text wraps the frame), uv.y
 * spans the band (0 = inner edge, 1 = outer edge). The center is left open so deeper rings show
 * through. Pure (no THREE).
 */
export function buildTunnelRing(p: TunnelRingParams): TunnelRingGeometry {
  const a = Math.max(0.01, p.halfW)
  const b = Math.max(0.01, p.halfH)
  const t = Math.max(0.001, p.thickness)
  const half = t / 2
  const shape = p.shape ?? 'rect'

  // Per-shape centerline: total perimeter + a point(s) sampler (position + outward normal). The
  // band sweep below is identical for every shape.
  const r = Math.max(0, Math.min(p.cornerRadius ?? t / 2, a - 1e-3, b - 1e-3))
  let perimeter: number
  let point: (s: number) => PathPoint
  if (shape === 'circle') {
    perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))   // Ramanujan ellipse
    point = (s) => ellipsePoint(s, perimeter, a, b)
  } else if (shape === 'diamond') {
    perimeter = 4 * Math.hypot(a, b)
    point = (s) => diamondPoint(s, a, b)
  } else {
    const sx = 2 * (a - r), sy = 2 * (b - r), arc = r * HALF_PI
    perimeter = 2 * sx + 2 * sy + 4 * arc
    point = (s) => roundedRectPoint(s, a, b, r)
  }

  // Resolution: dense enough that corners + glyphs stay smooth.
  const N = Math.max(256, Math.round(perimeter / Math.max(1e-3, t * 0.25)))

  // Sample the centerline (position + outward normal).
  const cx = new Float64Array(N + 1), cy = new Float64Array(N + 1)
  const nx = new Float64Array(N + 1), ny = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) {
    const pt = point((i / N) * perimeter)
    cx[i] = pt.x; cy[i] = pt.y; nx[i] = pt.nx; ny[i] = pt.ny
  }
  if (shape === 'diamond') {
    // ROUND only the TIPS: keep the straight edges, replace each sharp vertex with a small circular
    // arc (radius ~ band thickness) so the diamond stays crisp but the band/stroke sweeps a smooth
    // path with no spike. Build the centerline (arcs + straight joins), resample uniformly by arc
    // length, then take outward normals ⟂ the central-difference tangent.
    const verts: [number, number][] = [[0, b], [a, 0], [0, -b], [-a, 0]]   // CW from top
    const cr = Math.min(t * 1.2, Math.hypot(a, b) * 0.28)
    const poly: [number, number][] = []
    for (let k = 0; k < 4; k++) {
      const V = verts[k]!, P = verts[(k + 3) % 4]!, Q = verts[(k + 1) % 4]!
      const ul = Math.hypot(V[0] - P[0], V[1] - P[1]), wl = Math.hypot(Q[0] - V[0], Q[1] - V[1])
      const ux = (V[0] - P[0]) / ul, uy = (V[1] - P[1]) / ul       // incoming dir
      const wx = (Q[0] - V[0]) / wl, wy = (Q[1] - V[1]) / wl       // outgoing dir
      const gamma = Math.acos(Math.max(-1, Math.min(1, -ux * wx + -uy * wy))) / 2   // half interior angle
      const tl = Math.min(cr / Math.tan(gamma), ul * 0.5 - 1e-3, wl * 0.5 - 1e-3)
      const rr = tl * Math.tan(gamma)
      const pin: [number, number] = [V[0] - ux * tl, V[1] - uy * tl]
      const pout: [number, number] = [V[0] + wx * tl, V[1] + wy * tl]
      let bx = -ux + wx, by = -uy + wy; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl
      const cxr = V[0] + bx * (rr / Math.sin(gamma)), cyr = V[1] + by * (rr / Math.sin(gamma))   // arc centre (inward)
      let a0 = Math.atan2(pin[1] - cyr, pin[0] - cxr), a1 = Math.atan2(pout[1] - cyr, pout[0] - cxr)
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI
      const steps = 8
      for (let j = 0; j <= steps; j++) { const ang = a0 + d * (j / steps); poly.push([cxr + rr * Math.cos(ang), cyr + rr * Math.sin(ang)]) }
    }

    const M = poly.length
    const seg = new Float64Array(M)
    let per = 0
    for (let i = 0; i < M; i++) { const p = poly[i]!, q = poly[(i + 1) % M]!; seg[i] = Math.hypot(q[0] - p[0], q[1] - p[1]); per += seg[i]! }
    perimeter = per
    let segIdx = 0, segStart = 0
    for (let i = 0; i <= N; i++) {
      const tgt = Math.min(per - 1e-6, (i / N) * per)
      while (segIdx < M - 1 && segStart + seg[segIdx]! < tgt) { segStart += seg[segIdx]!; segIdx++ }
      const f = seg[segIdx]! > 1e-9 ? (tgt - segStart) / seg[segIdx]! : 0
      const p = poly[segIdx]!, q = poly[(segIdx + 1) % M]!
      cx[i] = p[0] + (q[0] - p[0]) * f
      cy[i] = p[1] + (q[1] - p[1]) * f
    }
    for (let i = 0; i <= N; i++) {
      const ia = ((i - 1) % N + N) % N, ib = (i + 1) % N
      let ox = cy[ib] - cy[ia], oy = -(cx[ib] - cx[ia])           // ⟂ tangent
      if (ox * cx[i] + oy * cy[i] < 0) { ox = -ox; oy = -oy }     // face outward
      const l = Math.hypot(ox, oy) || 1
      nx[i] = ox / l; ny[i] = oy / l
    }
  }

  const positions = new Float32Array((N + 1) * 2 * 3)
  const uvs = new Float32Array((N + 1) * 2 * 2)
  for (let i = 0; i <= N; i++) {
    const o = i * 2, inr = i * 2 + 1
    positions[o * 3] = cx[i] + half * nx[i]; positions[o * 3 + 1] = cy[i] + half * ny[i]; positions[o * 3 + 2] = 0
    positions[inr * 3] = cx[i] - half * nx[i]; positions[inr * 3 + 1] = cy[i] - half * ny[i]; positions[inr * 3 + 2] = 0
    const u = i / N
    uvs[o * 2] = u; uvs[o * 2 + 1] = 1      // outer edge
    uvs[inr * 2] = u; uvs[inr * 2 + 1] = 0  // inner edge
  }

  const indices = new Uint32Array(N * 6)
  for (let i = 0; i < N; i++) {
    const o = i * 2, inr = i * 2 + 1, no = (i + 1) * 2, ni = (i + 1) * 2 + 1, k = i * 6
    indices[k] = o; indices[k + 1] = inr; indices[k + 2] = no
    indices[k + 3] = no; indices[k + 4] = inr; indices[k + 5] = ni
  }
  return { positions, uvs, indices, perimeter }
}
