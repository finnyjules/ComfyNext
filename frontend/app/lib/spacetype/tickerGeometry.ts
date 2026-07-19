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

export function buildTickerGeometryData(p: TickerGeoParams): TickerGeoData {
  const n = Math.max(1, Math.floor(p.segments))
  const amp = Math.min(Math.abs(p.amplitude), maxAmplitude(p.frequency, p.length, p.height))
  const q: TickerGeoParams = { ...p, amplitude: Math.sign(p.amplitude || 1) * amp }

  const pts: { x: number; y: number }[] = []
  const cum = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const c = tickerPoint(i / n, q)
    pts.push(c)
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(c.x - pts[i - 1]!.x, c.y - pts[i - 1]!.y)
  }
  const arcLength = cum[n]!
  const uRepeatEffective = p.uRepeat * (arcLength / Math.max(1e-6, p.length))

  const verts = (n + 1) * 2
  const positions = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  const half = p.height / 2

  for (let i = 0; i <= n; i++) {
    // Central difference for the tangent so interior normals don't lag half a segment.
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(n, i + 1)]!
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    // In-plane normal — this is what keeps band width constant around bends.
    const nx = -(ty / len) * half
    const ny = (tx / len) * half

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
