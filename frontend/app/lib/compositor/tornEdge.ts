export type TornEdgeStyle = 'ripped' | 'deckle' | 'shredded'

export const TORN_EDGE_STYLES: readonly TornEdgeStyle[] = ['ripped', 'deckle', 'shredded']

export interface TornEdgeSpec {
  style: TornEdgeStyle
  amount: number        // tear depth into the element (px)
  roughness: number     // fray/meander detail, 0..1
  grain: number         // grain dissolve band width (px, 0 = crisp)
  grainTexture: number  // paper-fibre texture strength on the lip, 0..1
  lipWidth: number      // average white-lip band width (px, 0 = no lip)
  lipVariation: number  // how much the lip width varies along the edge, 0..1
  lipColor: string      // hex, warm paper-white default
  seed: number          // deterministic — same seed = same tear
}

export const DEFAULT_TORN_EDGE: TornEdgeSpec = {
  style: 'shredded',
  amount: 37,
  roughness: 0.18,
  grain: 7,
  grainTexture: 0.6,
  lipWidth: 10,
  lipVariation: 0.73,
  lipColor: '#fbf6ee',
  seed: 12,
}

/** Bounds each numeric field is clamped to. */
const CLAMP: Record<string, [number, number]> = {
  amount: [0, 200], roughness: [0, 1], grain: [0, 60], grainTexture: [0, 1],
  lipWidth: [0, 80], lipVariation: [0, 1], seed: [0, 1e9],
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Active when it would visibly change the edge (some tear, grain, or lip). */
export function tornEdgeActive(t: TornEdgeSpec | undefined | null): t is TornEdgeSpec {
  return !!t && (t.amount > 0 || t.grain > 0 || t.lipWidth > 0)
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Merge a partial/raw patch over `cur` (or DEFAULT), clamping every field. */
export function sanitizeTornEdge(raw: unknown, cur?: TornEdgeSpec): TornEdgeSpec {
  const base = cur ? { ...cur } : { ...DEFAULT_TORN_EDGE }
  const r = (raw ?? {}) as Record<string, unknown>
  const style = TORN_EDGE_STYLES.includes(r.style as TornEdgeStyle) ? (r.style as TornEdgeStyle) : base.style
  const color = typeof r.lipColor === 'string' && HEX.test(r.lipColor) ? r.lipColor : base.lipColor
  return {
    style,
    amount: num(r.amount, ...CLAMP.amount!, base.amount),
    roughness: num(r.roughness, ...CLAMP.roughness!, base.roughness),
    grain: num(r.grain, ...CLAMP.grain!, base.grain),
    grainTexture: num(r.grainTexture, ...CLAMP.grainTexture!, base.grainTexture),
    lipWidth: num(r.lipWidth, ...CLAMP.lipWidth!, base.lipWidth),
    lipVariation: num(r.lipVariation, ...CLAMP.lipVariation!, base.lipVariation),
    lipColor: color,
    seed: num(r.seed, ...CLAMP.seed!, base.seed),
  }
}

// ── Seeded noise ─────────────────────────────────────────────────────────────
function makeNoise(seed: number) {
  const h2 = (ix: number, iy: number) => {
    const x = Math.sin(ix * 127.1 + iy * 311.7 + seed * 13.7) * 43758.5453
    return x - Math.floor(x)
  }
  const value2 = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
    const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1)
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  const fbm2 = (x: number, y: number, oct: number, pers: number) => {
    let amp = 1, sum = 0, norm = 0, f = 1
    for (let o = 0; o < oct; o++) { sum += value2(x * f + o * 17.3, y * f + o * 17.3) * amp; norm += amp; f *= 2; amp *= pers }
    return sum / norm
  }
  const fineHash = (x: number, y: number) => {
    const v = Math.sin(x * 12.98 + y * 78.23 + seed * 3.7) * 43758.5453
    return v - Math.floor(v)
  }
  return { value2, fbm2, fineHash }
}

/** Approx Euclidean distance (chamfer 1 / √2) from each inside pixel to the
 *  nearest background pixel, computed only within [x0..x1]×[y0..y1]. */
function distanceInside(
  inside: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number,
): Float32Array {
  const INF = 1e9, a = 1, b = Math.SQRT2
  const d = new Float32Array(W * (y1 + 1))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; d[i] = inside[i] ? INF : 0 }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x; if (d[i] === 0) continue
    let m = d[i]
    if (x > x0) m = Math.min(m, d[i - 1] + a)
    if (y > y0) m = Math.min(m, d[i - W] + a)
    if (x > x0 && y > y0) m = Math.min(m, d[i - W - 1] + b)
    if (x < x1 && y > y0) m = Math.min(m, d[i - W + 1] + b)
    d[i] = m
  }
  for (let y = y1; y >= y0; y--) for (let x = x1; x >= x0; x--) {
    const i = y * W + x; if (d[i] === 0) continue
    let m = d[i]
    if (x < x1) m = Math.min(m, d[i + 1] + a)
    if (y < y1) m = Math.min(m, d[i + W] + a)
    if (x < x1 && y < y1) m = Math.min(m, d[i + W + 1] + b)
    if (x > x0 && y < y1) m = Math.min(m, d[i + W - 1] + b)
    d[i] = m
  }
  return d
}

function parseHexRGB(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Carve the ragged edge + paint the lip directly on an RGBA buffer. Mutates `data`.
 *  `scale` = device px per logical px; keeps feature sizes physically stable on retina. */
export function applyTornEdgeToData(
  data: Uint8ClampedArray, W: number, H: number, spec: TornEdgeSpec, scale: number,
): void {
  const s = scale > 0 ? scale : 1
  // 1. binary alpha mask + bounding box of opaque content
  const inside = new Uint8Array(W * H)
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3]! > 8) {
      inside[y * W + x] = 1
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) return   // fully transparent — nothing to tear

  const amountDev = Math.max(0, spec.amount * s)
  const grainDev = Math.max(0, spec.grain * s)
  const lipDev = Math.max(0, spec.lipWidth * s)
  const lipVar = Math.max(0, Math.min(1, spec.lipVariation))
  const rough = Math.max(0, Math.min(1, spec.roughness))
  const tex = Math.max(0, Math.min(1, spec.grainTexture))
  const maxLipDev = lipDev * (1 + lipVar * 1.4)
  // Max depth multiplier depthMul() can return, per style — the band must reserve
  // for it or the interior early-continue clips deep tears (shredded reaches ~1.75).
  const maxDepthMul = spec.style === 'shredded' ? (0.15 + 0.7 + 0.9 * rough) : 1.0
  const band = amountDev * maxDepthMul + maxLipDev + grainDev + 2

  const x0 = Math.max(0, Math.floor(minx - band)), y0 = Math.max(0, Math.floor(miny - band))
  const x1 = Math.min(W - 1, Math.ceil(maxx + band)), y1 = Math.min(H - 1, Math.ceil(maxy + band))
  const dist = distanceInside(inside, W, x0, y0, x1, y1)

  const { value2, fbm2, fineHash } = makeNoise(spec.seed)
  const fBase = spec.style === 'deckle' ? 0.03 : spec.style === 'ripped' ? 0.018 : 0.02
  const f = fBase / s
  const fl = 0.016 / s
  const [lr, lg, lb] = parseHexRGB(spec.lipColor)

  const depthMul = (x: number, y: number): number => {
    if (spec.style === 'deckle') return 0.15 + 0.85 * fbm2(x * f, y * f, 3, 0.45)
    if (spec.style === 'ripped') {
      const warp = fbm2(x * f * 0.45 + 3.1, y * f * 0.45 + 3.1, 3, 0.5) * 1.4 * (0.4 + rough)
      return 0.15 + 0.85 * fbm2(x * f + warp, y * f + warp, 5, 0.4 + 0.35 * rough)
    }
    const b2 = fbm2(x * f, y * f, 6, 0.55 + 0.4 * rough)
    const sp = Math.pow(fbm2(x * f * 1.7 + 9, y * f * 1.7 + 9, 4, 0.6), 2.2)
    return Math.max(0, 0.15 + 0.7 * b2 + 0.9 * sp * rough)
  }
  const lipMul = (x: number, y: number): number => {
    const env = fbm2(x * fl + 41, y * fl + 41, 3, 0.55)
    return Math.max(0, 1 + lipVar * 1.4 * ((env - 0.5) * 2))
  }
  const grainField = (x: number, y: number): number => {
    const clump = value2(x * 0.35 / s, y * 0.35 / s)
    const fine = 0.5 * value2(x * 0.9 / s, y * 0.9 / s) + 0.5 * fineHash(x / s, y / s)
    return clump * 0.55 + fine * 0.45
  }
  const paperTex = (x: number, y: number): number =>
    0.6 * value2(x * 0.12 / s + 7, y * 0.12 / s + 7)
    + 0.25 * value2(x * 0.5 / s + 3, y * 0.5 / s + 3)
    + 0.15 * fineHash(x / s + 11, y / s + 11)

  const bw = grainDev > 0 ? grainDev : 0.0001

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x
    if (!inside[i]) continue
    const dEdge = dist[i]!
    if (dEdge >= band) continue           // deep interior — untouched (boundary-band bound)
    const sT = dEdge - amountDev * depthMul(x, y)
    const g = grainField(x, y)
    const paper = sT <= 0 ? 0 : (sT >= bw ? 1 : (g < sT / bw ? 1 : 0))
    const o = i * 4
    if (!paper) { data[o + 3] = 0; continue }
    const sC = sT - lipDev * lipMul(x, y)
    const content = sC <= 0 ? 0 : (sC >= bw ? 1 : (g < sC / bw ? 1 : 0))
    if (!content) {                       // lip band — paper colour + fibre texture
      const lf = 1 + (paperTex(x, y) - 0.5) * 0.55 * tex
      data[o] = Math.max(0, Math.min(255, lr * lf))
      data[o + 1] = Math.max(0, Math.min(255, lg * lf))
      data[o + 2] = Math.max(0, Math.min(255, lb * lf))
      data[o + 3] = 255
    }
    // content pixel: left exactly as drawn (no texture)
  }
}

/** Canvas wrapper — reads the device pixels, tears them, writes them back. */
export function applyTornEdge(
  canvas: HTMLCanvasElement, spec: TornEdgeSpec, opts: { scale?: number } = {},
): void {
  const W = canvas.width, H = canvas.height
  if (!W || !H) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W, H)
  applyTornEdgeToData(img.data, W, H, spec, opts.scale ?? 1)
  ctx.putImageData(img, 0, 0)
}
