import { distanceInside } from '~/lib/compositor/tornEdge'

export interface FeatherSpec {
  amount: number              // feather depth, relative to the ELEMENT's own size (0..1); 1 ≈ fade reaches the element's center
  curve: 'linear' | 'smooth'  // alpha falloff shape across the band
}

export const DEFAULT_FEATHER: FeatherSpec = {
  amount: 0.15,
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
  data: Uint8ClampedArray, W: number, H: number, spec: FeatherSpec,
): void {
  const amount = Math.max(0, Math.min(1, spec.amount))
  if (amount <= 0) return

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

  // Feather reach is relative to the ELEMENT's own rendered size, not the canvas,
  // so `amount` behaves the same for a small logo and a full-frame photo. The
  // reference is half the narrower bbox dimension — the deepest an inward fade can
  // reach — so amount=1 fades the band all the way to the element's medial axis
  // (near-full dissolve) and small amounts give a thin edge fade. Measured in the
  // offscreen's device pixels, so it is inherently dpr- and resize-stable.
  const refExtent = 0.5 * Math.min(maxx - minx + 1, maxy - miny + 1)
  const featherDev = amount * refExtent
  if (featherDev <= 0) return

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
export function applyFeather(canvas: HTMLCanvasElement, spec: FeatherSpec): void {
  const W = canvas.width, H = canvas.height
  if (!W || !H) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W, H)
  applyFeatherToData(img.data, W, H, spec)
  ctx.putImageData(img, 0, 0)
}
