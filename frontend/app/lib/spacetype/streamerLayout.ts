export interface Rgb { r: number; g: number; b: number }
export interface BandGeometry { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; cells: number }

export function streamerRadius(segmentCount: number, segmentSpace: number): number {
  return (segmentCount * segmentSpace) / Math.PI
}

/** Character cells around one full loop (perimeter / segmentSpace). */
export function streamerCycle(segmentCount: number, middleStretch: number): number {
  return Math.round(2 * segmentCount + 2 * segmentCount * middleStretch)
}

/** Racetrack centerline point at arc-length `s` (XY plane): top straight → right semicircle →
 *  bottom straight → left semicircle. straightLen 0 ⇒ a plain oval. */
function racetrackPoint(s: number, straightLen: number, arcLen: number, r: number): { x: number; y: number } {
  if (s < straightLen) return { x: s, y: 0 }                                  // top straight →
  s -= straightLen
  if (s < arcLen) { const a = s / r; return { x: straightLen + r * Math.sin(a), y: r - r * Math.cos(a) } }  // right arc ↓
  s -= arcLen
  if (s < straightLen) return { x: straightLen - s, y: 2 * r }                // bottom straight ←
  s -= straightLen
  const a = s / r; return { x: -r * Math.sin(a), y: r + r * Math.cos(a) }     // left arc ↑
}

/**
 * Continuous swept band around the racetrack: 2 verts per sample offset ±depth/2 along Z, so the
 * band has one consistent +Z (front) face and one −Z (back) face all the way around — no per-tile
 * facing flips. uv.x runs 0→1 once around the loop (for fixed gradient + scrolling text); uv.y
 * spans the band width. `cells` = character cells around the loop. Pure (no THREE).
 */
export function buildStreamerGeometry(segmentCount: number, segmentSpace: number, middleStretch: number, depth: number): BandGeometry {
  const r = streamerRadius(segmentCount, segmentSpace)
  const straightLen = segmentCount * segmentSpace * middleStretch
  const arcLen = Math.PI * r
  const perimeter = 2 * straightLen + 2 * arcLen
  const cells = Math.max(1, Math.round(perimeter / Math.max(1e-3, segmentSpace)))
  const N = Math.max(96, Math.round(perimeter / Math.max(1e-3, segmentSpace) * 6))  // samples around the loop
  const half = depth / 2
  const positions = new Float32Array((N + 1) * 2 * 3)
  const uvs = new Float32Array((N + 1) * 2 * 2)
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * perimeter
    const p = racetrackPoint(s, straightLen, arcLen, r)
    const a = i * 2, b = i * 2 + 1
    positions[a * 3] = p.x; positions[a * 3 + 1] = p.y; positions[a * 3 + 2] = half
    positions[b * 3] = p.x; positions[b * 3 + 1] = p.y; positions[b * 3 + 2] = -half
    const u = i / N
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0
  }
  const indices = new Uint32Array(N * 6)
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1, o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }
  return { positions, uvs, indices, cells }
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(s, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

/**
 * Gradient color for window slot `slot` of `runLength`, banded across `stops` (STG setGradient):
 * the run is split into stops.length-1 equal bands and lerped within each. Returns rgb in 0..1.
 */
export function gradientColorAt(slot: number, runLength: number, stops: string[]): Rgb {
  if (stops.length <= 1) return hexToRgb(stops[0] ?? '#ffffff')
  const bands = stops.length - 1
  const f = Math.min(1, Math.max(0, runLength > 0 ? slot / runLength : 0)) * bands
  const idx = Math.min(bands - 1, Math.floor(f))
  const local = f - idx
  const a = hexToRgb(stops[idx]!), b = hexToRgb(stops[idx + 1]!)
  return { r: lerp(a.r, b.r, local), g: lerp(a.g, b.g, local), b: lerp(a.b, b.b, local) }
}
