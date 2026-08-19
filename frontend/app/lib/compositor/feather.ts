import { distanceInside } from '~/lib/compositor/tornEdge'

export interface FeatherSpec {
  amount: number              // feather depth, normalized to canvas WIDTH (0..1)
  curve: 'linear' | 'smooth'  // alpha falloff shape across the band
}

export const DEFAULT_FEATHER: FeatherSpec = {
  amount: 0.03,
  curve: 'smooth',
}

/** Active when it would visibly fade the edge. */
export function featherActive(f: FeatherSpec | undefined | null): f is FeatherSpec {
  return !!f && f.amount > 0
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Merge a partial/raw patch over `cur` (or DEFAULT), clamping every field. */
export function sanitizeFeather(raw: unknown, cur?: FeatherSpec): FeatherSpec {
  const base = cur ? { ...cur } : { ...DEFAULT_FEATHER }
  const r = (raw ?? {}) as Record<string, unknown>
  const curve = r.curve === 'linear' || r.curve === 'smooth' ? r.curve : base.curve
  return {
    amount: num(r.amount, 0, 1, base.amount),
    curve,
  }
}

/** Fade the alpha of each opaque pixel by its distance to the nearest transparent
 *  pixel, across a `featherDev`-wide band. Mutates `data`.
 *  `scale` = device px per logical px; `canvasW` = logical canvas width. Feather
 *  reaches `amount * canvasW * scale` device px inward from the silhouette edge. */
export function applyFeatherToData(
  data: Uint8ClampedArray, W: number, H: number, spec: FeatherSpec, scale: number, canvasW: number,
): void {
  const s = scale > 0 ? scale : 1
  const featherDev = Math.max(0, spec.amount * canvasW * s)
  if (featherDev <= 0) return

  // binary alpha mask + bounding box of opaque content
  const inside = new Uint8Array(W * H)
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3]! > 8) {
      inside[y * W + x] = 1
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) return   // fully transparent — nothing to feather

  const band = featherDev + 2
  const x0 = Math.max(0, Math.floor(minx - band)), y0 = Math.max(0, Math.floor(miny - band))
  const x1 = Math.min(W - 1, Math.ceil(maxx + band)), y1 = Math.min(H - 1, Math.ceil(maxy + band))
  const dist = distanceInside(inside, W, x0, y0, x1, y1)
  const smooth = spec.curve === 'smooth'

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x
    if (!inside[i]) continue
    const d = dist[i]!
    if (d >= featherDev) continue          // deep interior — full alpha
    let t = d / featherDev                  // 0 at edge, →1 at band inner rim
    if (t < 0) t = 0
    if (smooth) t = t * t * (3 - 2 * t)     // smoothstep
    const o = i * 4 + 3
    data[o] = Math.round(data[o]! * t)
  }
}

/** Canvas wrapper — reads device pixels, feathers them, writes them back. */
export function applyFeather(
  canvas: HTMLCanvasElement, spec: FeatherSpec, opts: { scale?: number; canvasW: number },
): void {
  const W = canvas.width, H = canvas.height
  if (!W || !H) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W, H)
  applyFeatherToData(img.data, W, H, spec, opts.scale ?? 1, opts.canvasW)
  ctx.putImageData(img, 0, 0)
}
