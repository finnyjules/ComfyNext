import { mulberry32 } from './rng'

export interface Rgb { r: number; g: number; b: number }
export interface BandGeometry { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; cells: number }

/**
 * A repeating cycle of straight-row lengths (one entry per row in the cycle). `count` is forced
 * EVEN so the boustrophedon direction parity repeats with the cycle (the path stays periodic, which
 * keeps the motion loop seamless). `jitter` 0..1 scales each row up to ±70% around `base`, seeded so
 * the same seed always yields the same pattern. jitter 0 → every row equals `base` (uniform).
 */
export function buildRowLengths(base: number, count: number, jitter: number, seed: number): number[] {
  const C = Math.max(2, count % 2 === 0 ? count : count + 1)
  const rng = mulberry32((Number.isFinite(seed) ? seed : 1) >>> 0)
  const j = Number.isFinite(jitter) ? Math.max(0, Math.min(1, jitter)) : 0
  const out: number[] = []
  for (let k = 0; k < C; k++) {
    const f = 1 + j * (rng() * 2 - 1) * 0.7
    out.push(Math.max(base * 0.15, base * f))
  }
  return out
}

/**
 * Varied open serpentine at arc-length `s`: like serpentinePoint but each row takes its length from
 * the repeating `rowLens` cycle (length must be even). The path is periodic — advancing `s` by one
 * full cycle reproduces the shape translated straight down by C·2r — so the flow loops seamlessly
 * after the centroid re-centering. `r` = arc radius (uniform).
 */
export function serpentineVariedPoint(s: number, rowLens: number[], r: number): { x: number; y: number; tx: number; ty: number } {
  const C = rowLens.length
  const arc = Math.PI * r
  let cycle = 0
  for (let k = 0; k < C; k++) cycle += rowLens[k]! + arc
  const cyc = Math.floor(s / cycle)
  let local = s - cyc * cycle
  const yOff = -cyc * C * 2 * r           // descent accumulated over whole cycles
  for (let k = 0; k < C; k++) {
    const L = rowLens[k]!
    const seg = L + arc
    const dir = k % 2 === 0 ? 1 : -1
    const yRow = -k * 2 * r + yOff
    if (local <= L) {                     // straight run
      return { x: dir > 0 ? local : L - local, y: yRow, tx: dir, ty: 0 }
    }
    if (local <= seg) {                   // connecting arc down to the next row
      const a = (local - L) / r
      const cx = dir > 0 ? L : 0
      const cy = yRow - r
      return { x: cx + dir * r * Math.sin(a), y: cy + r * Math.cos(a), tx: dir * Math.cos(a), ty: -Math.sin(a) }
    }
    local -= seg
  }
  return { x: 0, y: yOff, tx: 1, ty: 0 }  // unreachable
}

/**
 * Open serpentine (boustrophedon) centerline at arc-length `s`: straight rows alternating
 * direction, joined by 180° half-circle arcs on alternating ends, descending. NOT a closed loop.
 * `rowLen` = straight length, `r` = arc radius (rows are 2r apart). Returns position + the unit
 * tangent (for sweeping the band width perpendicular to flow).
 */
export function serpentinePoint(s: number, rowLen: number, r: number): { x: number; y: number; tx: number; ty: number } {
  const arc = Math.PI * r
  const seg = rowLen + arc                 // one straight + one connecting arc
  const ss = Math.max(0, s)
  const row = Math.floor(ss / seg)
  const t = ss - row * seg
  const dir = row % 2 === 0 ? 1 : -1       // even rows flow +x, odd rows −x
  const yRow = -row * 2 * r
  if (t <= rowLen) {                       // straight run
    const x = dir > 0 ? t : rowLen - t
    return { x, y: yRow, tx: dir, ty: 0 }
  }
  // half-circle arc down to the next row, on the right end (even rows) or left end (odd rows)
  const a = (t - rowLen) / r               // 0..π
  const cx = dir > 0 ? rowLen : 0          // arc centre x at the run's end
  const cy = yRow - r                      // centre half a gap below
  const sgn = dir                          // bulge outward on the flow side
  const x = cx + sgn * r * Math.sin(a)
  const y = cy + r * Math.cos(a)
  // tangent = d/da (sin, cos) scaled by dir → (cos a, -sin a) on the flow side
  return { x, y, tx: sgn * Math.cos(a), ty: -Math.sin(a) }
}

/**
 * Continuous swept band along the serpentine: 2 verts per sample offset ±depth/2 along Z, so the
 * band keeps one consistent +Z (front) face and one −Z (back) face the whole way — no facing
 * flips. uv.x runs 0→1 across the WHOLE path (for the gradient + the text that flows along it);
 * uv.y spans the band width. `cells` = character cells along the path. Pure (no THREE).
 */
export function buildStreamerGeometry(rowChars: number, segmentSpace: number, rows: number, depth: number, arcRadius: number): BandGeometry {
  const rowLen = Math.max(1, rowChars) * segmentSpace
  const r = Math.max(1, arcRadius)
  const nRows = Math.max(1, Math.round(rows))
  const pathLen = nRows * rowLen + (nRows - 1) * Math.PI * r   // straights + connecting arcs (open ends)
  const cells = Math.max(1, Math.round(pathLen / Math.max(1e-3, segmentSpace)))
  const N = Math.max(96, cells * 6)
  const half = depth / 2
  const positions = new Float32Array((N + 1) * 2 * 3)
  const uvs = new Float32Array((N + 1) * 2 * 2)
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * pathLen
    const p = serpentinePoint(s, rowLen, r)
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
