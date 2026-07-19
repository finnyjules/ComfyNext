const TAU = Math.PI * 2

/**
 * Geometry for the Ticker effect: a flat band in the XY plane whose centreline is a sine,
 * swept along the IN-PLANE normal, with UVs parameterised by ARC LENGTH.
 *
 * Deliberately NOT ribbonGeometry.ts. Ribbon sweeps its band along world Z (edge-on in depth)
 * and maps u uniformly in the curve parameter t, so glyphs stretch through bends and bunch on
 * straights. Ticker fixes both: the band faces camera, and equal arc length gets equal u, so a
 * glyph occupies the same physical run of band on a curve as on a straight.
 */
export interface TickerGeoParams {
  segments: number
  length: number
  amplitude: number
  frequency: number
  /** Caller bakes the travelling-wave term in: rowPhase + waveSpeed * t01 * TAU. */
  phase: number
  height: number
  /** Repeats across the STRAIGHT length. Scaled up by the arc-length ratio in the output. */
  uRepeat: number
}

export interface TickerGeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  arcLength: number
  /** uRepeat * (arcLength / length). Deliberately fractional — see the spec: the remainder
   *  truncates at the band's END, where glyphs already scroll out of view. */
  uRepeatEffective: number
}

/** Centreline point at t in [0,1]. z is always 0 — this is a 2D path by construction. */
export function tickerPoint(t: number, p: TickerGeoParams): { x: number; y: number } {
  return {
    x: (t - 0.5) * p.length,
    y: p.amplitude * Math.sin(TAU * p.frequency * t + p.phase),
  }
}

/**
 * Largest amplitude before the band self-intersects on a bend.
 *
 * For y = A·sin(kx) the peak curvature is A·k², so the centre of curvature sits 1/(A·k²) away.
 * The inner edge folds through itself once that radius drops below the band's half-height, so
 * the limit is A < 2/(k²·h). Clamping is deliberate: a miter-joint solver is out of scope.
 */
export function maxAmplitude(frequency: number, length: number, height: number): number {
  const k = (TAU * frequency) / Math.max(1e-6, length)
  return 2 / Math.max(1e-9, k * k * Math.max(1e-6, height))
}

/** One centreline walk: the sampled points, their cumulative arc length, and the UNIT in-plane
 *  normal at each sample. Shared by the band and the stroke so the rails provably ride the same
 *  curve — a parallel reimplementation would be free to drift off the band's edge. */
interface Centreline {
  n: number
  pts: { x: number; y: number }[]
  cum: Float64Array
  arcLength: number
  /** Unit normal at sample i, written into `out`. */
  normalAt(i: number, out: { x: number; y: number }): void
}

function sampleCentreline(p: TickerGeoParams): Centreline {
  const n = Math.max(1, Math.floor(p.segments))
  // Clamped identically for band and stroke — see maxAmplitude. If this clamp lived in only one
  // of the two builders they would diverge at high amplitude.
  const amp = Math.min(Math.abs(p.amplitude), maxAmplitude(p.frequency, p.length, p.height))
  const q: TickerGeoParams = { ...p, amplitude: Math.sign(p.amplitude || 1) * amp }

  const pts: { x: number; y: number }[] = []
  const cum = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const c = tickerPoint(i / n, q)
    pts.push(c)
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(c.x - pts[i - 1]!.x, c.y - pts[i - 1]!.y)
  }

  return {
    n,
    pts,
    cum,
    arcLength: cum[n]!,
    normalAt(i, out) {
      // Central difference for the tangent so interior normals don't lag half a segment.
      const prev = pts[Math.max(0, i - 1)]!
      const next = pts[Math.min(n, i + 1)]!
      const tx = next.x - prev.x
      const ty = next.y - prev.y
      const len = Math.hypot(tx, ty) || 1
      out.x = -(ty / len)
      out.y = tx / len
    },
  }
}

export function buildTickerGeometryData(p: TickerGeoParams): TickerGeoData {
  const { n, pts, cum, arcLength, normalAt } = sampleCentreline(p)
  const uRepeatEffective = p.uRepeat * (arcLength / Math.max(1e-6, p.length))

  const verts = (n + 1) * 2
  const positions = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  const half = p.height / 2
  const nrm = { x: 0, y: 0 }

  for (let i = 0; i <= n; i++) {
    // In-plane normal — this is what keeps band width constant around bends.
    normalAt(i, nrm)
    const nx = nrm.x * half
    const ny = nrm.y * half

    const c = pts[i]!
    const a = i * 2, b = i * 2 + 1
    positions[a * 3] = c.x + nx; positions[a * 3 + 1] = c.y + ny; positions[a * 3 + 2] = 0
    positions[b * 3] = c.x - nx; positions[b * 3 + 1] = c.y - ny; positions[b * 3 + 2] = 0

    const u = (cum[i]! / Math.max(1e-9, arcLength)) * uRepeatEffective
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0
  }

  const indices = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    const o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }

  return { positions, uvs, indices, arcLength, uRepeatEffective }
}

/**
 * The stroke plane: a hair in front of the band (which sits at z = 0).
 *
 * The rails are centred ON the band's edges, so their inner half is coplanar with the band. Left
 * at z = 0 that overlap z-fights — flickering speckle as the camera moves. This offset is
 * invisible at Ticker's scale and behaves more predictably across drivers than polygonOffset.
 */
export const STROKE_Z = 0.001

export interface TickerStrokeData {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * "Rails": an outline along the band's two long edges, as swept quads.
 *
 * Quads rather than lines because WebGL line width is effectively locked to 1px on nearly all
 * platforms — THREE.LineBasicMaterial.linewidth is silently ignored — so a line-based stroke
 * would ship a width slider that does nothing.
 *
 * Deliberately NO uvs: the rails are flat colour, so none of the band's arc-length
 * parameterisation applies. Open at the short ends by design; the band's ends are where glyphs
 * already scroll out of view, and closing the outline there would harden a soft boundary.
 *
 * Layout is 4 verts per sample — outerA, outerB, innerA, innerB — indexed as two independent
 * strips that share a buffer but no triangles.
 */
export function buildTickerStrokeData(p: TickerGeoParams, strokeWidth: number): TickerStrokeData {
  const w = Math.max(0, strokeWidth)
  // Zero width builds nothing at all: the caller skips the mesh entirely rather than adding a
  // degenerate one to the scene graph.
  if (w === 0) return { positions: new Float32Array(0), indices: new Uint32Array(0) }

  const { n, pts, normalAt } = sampleCentreline(p)
  const half = p.height / 2
  const hw = w / 2
  const positions = new Float32Array((n + 1) * 4 * 3)
  const nrm = { x: 0, y: 0 }

  for (let i = 0; i <= n; i++) {
    normalAt(i, nrm)
    const c = pts[i]!
    const base = i * 4
    // Each rail is CENTRED on its edge (half ± hw), so the stroke sits on the boundary rather
    // than inflating the silhouette.
    const offsets = [half + hw, half - hw, -(half - hw), -(half + hw)]
    for (let k = 0; k < 4; k++) {
      const o = offsets[k]!
      const v = (base + k) * 3
      positions[v] = c.x + nrm.x * o
      positions[v + 1] = c.y + nrm.y * o
      positions[v + 2] = STROKE_Z
    }
  }

  // Two quads per segment (one per rail), 6 indices each.
  const indices = new Uint32Array(n * 12)
  for (let i = 0; i < n; i++) {
    const cur = i * 4, nxt = (i + 1) * 4
    let o = i * 12
    for (const r of [0, 2]) {          // rail vert-pair offsets: outer = 0/1, inner = 2/3
      const a = cur + r, b = cur + r + 1, c = nxt + r, d = nxt + r + 1
      indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
      indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
      o += 6
    }
  }

  return { positions, indices }
}

/** Per-row placement: centred Y stack, phase offset, alternating scroll direction.
 *  Mirrors ribbonInstance's contract so the two effects behave predictably alike. */
export interface TickerRowParams { count: number; spacing: number; offset: number; alternate: boolean }
export interface TickerRow { y: number; phase: number; dir: 1 | -1 }

export function tickerRow(i: number, p: TickerRowParams): TickerRow {
  const n = Math.max(1, Math.floor(p.count))
  const center = (n - 1) / 2
  return {
    y: (i - center) * p.spacing,
    phase: i * p.offset * TAU,
    dir: p.alternate && i % 2 === 1 ? -1 : 1,
  }
}
