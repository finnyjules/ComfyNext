/**
 * String effect geometry (STG /string) — pure, no THREE import.
 *
 * Sweeps a swept ribbon along the cubic-bézier path of one string, sliced into
 * horizontal strips. Mirrors sketch_string.js: per-segment bézier sampling
 * (`cubic*`), perpendicular offset per strip (`buildStrip`), arc-length texture U
 * (`U = culmDist / heightRatio`), and the optional round-cap fans.
 */

const HALF_PI = Math.PI / 2

/** Absolute handle positions for a point, in whatever space the caller passes. */
export interface WorldPoint {
  x: number; y: number
  /** Forward handle (control toward the NEXT-drawn point). */
  fhx: number; fhy: number
  /** Back handle (control toward the PREVIOUS-drawn point). */
  bhx: number; bhy: number
}

export interface CenterSample {
  x: number; y: number
  /** Unit perpendicular (atan2(tangent) − π/2). */
  nx: number; ny: number
  /** Cumulative arc length from the string start. */
  s: number
}

export interface GeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/** Cubic bézier point at t (p0 → p3, controls c1,c2). */
export function cubicPoint(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3
}

/** Cubic bézier first derivative at t. */
export function cubicTangent(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t
  return 3 * u * u * (c1 - p0) + 6 * u * t * (c2 - c1) + 3 * t * t * (p3 - c2)
}

/**
 * Sample a string's centerline. STG pairing (sketch_string.js:317): the segment
 * between consecutive points uses the higher-index point's FORWARD handle as
 * control-1 and the lower-index point's BACK handle as control-2, traversed from
 * the LAST point to the first. We build it in that exact order so the curve and
 * arc-length match STG. Fewer than 2 points → empty.
 */
export function sampleString(points: WorldPoint[], stepsPerSeg: number): CenterSample[] {
  if (points.length < 2) return []
  const steps = Math.max(2, Math.floor(stepsPerSeg))
  const out: CenterSample[] = []
  let cum = 0
  let prevX = 0, prevY = 0
  // Walk segments from the last point down to the first (STG order).
  for (let j = points.length - 1; j > 0; j--) {
    const hi = points[j]!       // segment start (t=0)
    const lo = points[j - 1]!   // segment end   (t=1)
    // p0 = hi, c1 = hi.forward, c2 = lo.back, p3 = lo
    for (let k = 0; k <= steps; k++) {
      // Skip the duplicated joint vertex (k=0 of every segment after the first).
      if (j < points.length - 1 && k === 0) continue
      const t = k / steps
      const x = cubicPoint(hi.x, hi.fhx, lo.bhx, lo.x, t)
      const y = cubicPoint(hi.y, hi.fhy, lo.bhy, lo.y, t)
      const tx = cubicTangent(hi.x, hi.fhx, lo.bhx, lo.x, t)
      const ty = cubicTangent(hi.y, hi.fhy, lo.bhy, lo.y, t)
      const ang = Math.atan2(ty, tx) - HALF_PI
      if (out.length > 0) cum += Math.hypot(x - prevX, y - prevY)
      out.push({ x, y, nx: Math.cos(ang), ny: Math.sin(ang), s: cum })
      prevX = x; prevY = y
    }
  }
  return out
}

export interface StripSpec {
  /** Strip index within the ribbon (0…count−1). */
  index: number
  /** Number of strips the ribbon is sliced into. */
  count: number
  /** Total ribbon height (world units). */
  stripHeight: number
  /** Texture tile aspect (tileWidthPx / tileHeightPx) — sets the U repeat length. */
  texAspect: number
  /** Round semicircular caps at the ribbon ends. */
  roundCap: boolean
  /** Cap fan resolution (STG curveStop = 5). */
  capSegs?: number
}

/**
 * Build one strip's swept-ribbon geometry from centerline samples. Strip `m`
 * spans perpendicular [−H/2 + m·H/n, −H/2 + (m+1)·H/n]. Texture U = arc length /
 * heightRatio (heightRatio = texAspect · perStripHeight), V ∈ {0,1}.
 */
export function buildStrip(samples: CenterSample[], spec: StripSpec): GeoData {
  const n = Math.max(1, Math.floor(spec.count))
  const m = Math.min(n - 1, Math.max(0, Math.floor(spec.index)))
  if (samples.length < 2) {
    return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) }
  }
  const perStrip = spec.stripHeight / n
  const bottom = -spec.stripHeight / 2 + m * perStrip
  const top = -spec.stripHeight / 2 + (m + 1) * perStrip
  const heightRatio = Math.max(1e-4, spec.texAspect * perStrip)
  const capSegs = Math.max(1, Math.floor(spec.capSegs ?? 5))

  const positions: number[] = []
  const uvs: number[] = []

  const pushPair = (px: number, py: number, perpX: number, perpY: number, u: number) => {
    positions.push(px + perpX * bottom, py + perpY * bottom, 0)
    uvs.push(u, 1)
    positions.push(px + perpX * top, py + perpY * top, 0)
    uvs.push(u, 0)
  }

  const first = samples[0]!
  const last = samples[samples.length - 1]!

  // Leading round cap: a semicircular fan rotating the perpendicular ±90° (STG :343).
  if (spec.roundCap) {
    const u = first.s / heightRatio
    const base = Math.atan2(first.ny, first.nx)
    for (let b = capSegs; b >= 1; b--) {
      const aB = base + HALF_PI * (b / capSegs)
      const aT = base - HALF_PI * (b / capSegs)
      positions.push(first.x + Math.cos(aB) * bottom, first.y + Math.sin(aB) * bottom, 0)
      uvs.push(u, 1)
      positions.push(first.x + Math.cos(aT) * top, first.y + Math.sin(aT) * top, 0)
      uvs.push(u, 0)
    }
  }

  for (const smp of samples) pushPair(smp.x, smp.y, smp.nx, smp.ny, smp.s / heightRatio)

  // Trailing round cap (STG :358).
  if (spec.roundCap) {
    const u = last.s / heightRatio
    const base = Math.atan2(last.ny, last.nx)
    for (let b = 1; b <= capSegs; b++) {
      const aB = base - HALF_PI * (b / capSegs)
      const aT = base + HALF_PI * (b / capSegs)
      positions.push(last.x + Math.cos(aB) * bottom, last.y + Math.sin(aB) * bottom, 0)
      uvs.push(u, 1)
      positions.push(last.x + Math.cos(aT) * top, last.y + Math.sin(aT) * top, 0)
      uvs.push(u, 0)
    }
  }

  // Triangle-strip → indexed triangles. Vertices come in (bottom,top) pairs.
  const pairs = positions.length / 6
  const indices: number[] = []
  for (let i = 0; i < pairs - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    indices.push(a, b, c, c, b, d)
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}

/** Deterministic per-strip speed factor (replaces STG's random rSpeed; stable for seamless bakes). */
export function stripSpeedFactor(index: number, vary: number): number {
  // A fixed irrational-ish sequence in [0,1) → spread strips without RNG.
  const frac = (index * 0.6180339887) % 1
  return 1 + vary * (frac - 0.5) * 2
}
