export interface SpiralBandGeometry {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  /** Arc length of the whole helix centerline (world units, pre-normalisation). */
  pathLen: number
  /** Character cells along the path (drives text density). */
  cells: number
}

export interface SpiralParams {
  /** Helix radius (world units). */
  radius: number
  /** Number of full coils. */
  turns: number
  /** Vertical drop per full turn (world units). Pitch > ribbonHeight → gaps between coils. */
  pitch: number
  /** Band width across the ribbon (world units), oriented ~vertically (edge-wound). */
  ribbonHeight: number
  /** Nominal world length of one glyph cell (sizes path resolution + cell count). */
  segmentSpace?: number
  /** Spacing multipliers on `pitch` at the top / middle / bottom of the column (default 1 = uniform).
   *  <1 winds tighter (coils closer), >1 looser. Smoothly interpolated down the helix. */
  pitchTop?: number
  pitchMid?: number
  pitchBottom?: number
  /** Flip the helix chirality (coils twist the other way). Reverses triangle winding, so the
   *  caller must swap the front/back face sides + the text UV flip to match (see spiral.ts). */
  reverse?: boolean
}

const TWO_PI = Math.PI * 2

function clamp01(t: number): number { return t < 0 ? 0 : t > 1 ? 1 : t }
function smoothstep(t: number): number { const c = clamp01(t); return c * c * (3 - 2 * c) }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

/** Pitch spacing multiplier at normalized height u∈[0,1] (0 = top), smoothly blending the
 *  top→mid→bottom anchors. Two smoothstep halves so the middle anchor is hit exactly at u=0.5. */
export function pitchScaleAt(u: number, top: number, mid: number, bottom: number): number {
  return u <= 0.5 ? lerp(top, mid, smoothstep(u / 0.5)) : lerp(mid, bottom, smoothstep((u - 0.5) / 0.5))
}

/**
 * Helix centerline at angle `theta`: a circle of `radius` in the XZ plane descending along −Y at
 * `h` units per radian (h = pitch / 2π). Pure, so it's unit-testable.
 */
export function helixPoint(theta: number, radius: number, h: number): { x: number; y: number; z: number } {
  return { x: radius * Math.cos(theta), y: -h * theta, z: radius * Math.sin(theta) }
}

/**
 * A continuous swept band wound as an edge-wound helix (a "slinky"): the centerline is a helix and
 * the band width is offset ±half along the VERTICAL direction projected perpendicular to the path
 * tangent. That orientation makes each coil a near-vertical ribbon whose FRONT (outer, +normal)
 * face holds the text and whose BACK (inner, −normal) face shows through the gaps as the coils
 * tilt with the pitch — matching the STG "spring" look.
 *
 * Output mirrors streamerLayout's BandGeometry contract: 2 verts per sample (one per band edge),
 * uv.x running 0→1 across the WHOLE helix (text + gradient param) and uv.y spanning the band width
 * (0 = back edge, 1 = front edge). Pure (no THREE).
 */
export function buildSpiralGeometry(p: SpiralParams): SpiralBandGeometry {
  const R = Math.max(0.001, p.radius)
  const turns = Math.max(0.1, p.turns)
  const Theta = turns * TWO_PI
  const baseH = p.pitch / TWO_PI                  // nominal vertical rate (per radian)
  const half = Math.max(0.001, p.ribbonHeight) / 2
  const top = Math.max(0.05, p.pitchTop ?? 1)
  const mid = Math.max(0.05, p.pitchMid ?? 1)
  const bottom = Math.max(0.05, p.pitchBottom ?? 1)
  const zSign = p.reverse ? -1 : 1                // flip chirality (coils twist the other way)
  // Resolution sized off the nominal arc length (the local-pitch tweak barely moves it).
  const nominalLen = Theta * Math.hypot(R, baseH)
  const seg = Math.max(1e-3, p.segmentSpace ?? p.ribbonHeight * 0.6)
  const cells = Math.max(1, Math.round(nominalLen / seg))
  const N = Math.max(192, cells * 6)              // path samples − 1
  const dTheta = Theta / N

  // Per-sample local vertical rate h(θ) = baseH · pitchScale(u); the centerline y is its running
  // (trapezoidal) integral so the coils bunch/splay where the spacing multipliers ask them to.
  const hs = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) hs[i] = baseH * pitchScaleAt(i / N, top, mid, bottom)

  const positions = new Float32Array((N + 1) * 2 * 3)
  const uvs = new Float32Array((N + 1) * 2 * 2)
  let y = 0
  let pathLen = 0
  let pcx = R, pcy = 0, pcz = 0                   // previous centerline point (θ=0 = (R,0,0))
  for (let i = 0; i <= N; i++) {
    const theta = i * dTheta
    if (i > 0) y -= (hs[i - 1]! + hs[i]!) / 2 * dTheta   // integrate the variable pitch
    const cx = R * Math.cos(theta), cy = y, cz = zSign * R * Math.sin(theta)
    if (i > 0) pathLen += Math.hypot(cx - pcx, cy - pcy, cz - pcz)
    pcx = cx; pcy = cy; pcz = cz

    // Unit tangent uses the LOCAL vertical rate: T = (−R sinθ, −h(θ), ±R cosθ).
    let tx = -R * Math.sin(theta), ty = -hs[i]!, tz = zSign * R * Math.cos(theta)
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl

    // Band-width direction = world-up projected perpendicular to T (Gram–Schmidt). This keeps the
    // band ~vertical and tilted only by the helix pitch, so the coils read as a wound spring.
    const dotYT = ty                              // (0,1,0)·T
    let wx = -dotYT * tx, wy = 1 - dotYT * ty, wz = -dotYT * tz
    const wl = Math.hypot(wx, wy, wz) || 1
    wx /= wl; wy /= wl; wz /= wl

    const a = i * 2, b = i * 2 + 1
    positions[a * 3] = cx + half * wx; positions[a * 3 + 1] = cy + half * wy; positions[a * 3 + 2] = cz + half * wz
    positions[b * 3] = cx - half * wx; positions[b * 3 + 1] = cy - half * wy; positions[b * 3 + 2] = cz - half * wz
    const u = i / N
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1            // front edge
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0            // back edge
  }

  const indices = new Uint32Array(N * 6)
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1, o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }
  return { positions, uvs, indices, pathLen, cells }
}
