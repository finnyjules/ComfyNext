import { toHeightPixels } from '~/lib/scene3d/relief'

/**
 * Displacement-map spec attached to an image layer. Presence on the layer = active:
 * the layer stops drawing its own pixels and instead warps everything below it.
 */
export interface DisplaceMapSpec {
  /** How a map pixel's value becomes a push direction. */
  read: 'height' | 'channels' | 'bulge'
  /** Max push in SCREEN px (dpr-invariant); the renderer scales it to device px. */
  amount: number
  /** Height mode only: flip high/low. */
  invert?: boolean
  /** Blur the offset field by this px radius before warping (smooths jaggies). 0 = off. */
  softness?: number
}

export const DEFAULT_DISPLACE_MAP: DisplaceMapSpec = {
  read: 'height',
  amount: 40,
  invert: false,
  softness: 2,
}

/**
 * Turn a map image into a per-pixel offset field.
 * Returns a Float32Array of length w*h*2, interleaved [dx0,dy0,dx1,dy1,...], each
 * component normalized to roughly [-1,1] (the resample multiplies by `amount`).
 * The map's own alpha gates the offset — transparent map pixels push nothing — so a
 * small pasted image only distorts the backdrop under its footprint.
 */
export function buildDisplacementField(
  map: Uint8ClampedArray,
  w: number,
  h: number,
  spec: DisplaceMapSpec,
  pixelScale = 1,
): Float32Array {
  const field = new Float32Array(w * h * 2)
  if (w < 1 || h < 1) return field

  if (spec.read === 'channels') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4
        const a = map[p + 3]! / 255
        const o = (y * w + x) * 2
        field[o] = (map[p]! / 255 - 0.5) * 2 * a
        field[o + 1] = (map[p + 1]! / 255 - 0.5) * 2 * a
      }
    }
  } else if (spec.read === 'bulge') {
    // Bulge/pinch lens: push the backdrop radially from the map's (alpha-weighted) centre —
    // outward where the map is bright, inward where dark. Absolute brightness matters, so flat
    // areas act (unlike height). Value-based, so dpr-invariant (pixelScale not needed).
    let sumA = 0, sumX = 0, sumY = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = map[(y * w + x) * 4 + 3]!
        sumA += a; sumX += a * x; sumY += a * y
      }
    }
    if (sumA > 0) {
      const cx = sumX / sumA, cy = sumY / sumA
      // Farthest corner from the centroid normalises magnitude into ~[-1, 1].
      let rmax = 0
      for (const c of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
        const d = Math.hypot(c[0] - cx, c[1] - cy)
        if (d > rmax) rmax = d
      }
      if (rmax > 0) {
        const height = toHeightPixels(map, spec.invert ?? false) // reuse luma (+invert)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4
            const signed = (height[p]! / 255 - 0.5) * 2 // white → +1 (out), black → -1 (in)
            const a = map[p + 3]! / 255
            const o = (y * w + x) * 2
            field[o] = ((x - cx) / rmax) * signed * a
            field[o + 1] = ((y - cy) / rmax) * signed * a
          }
        }
      }
    }
  } else {
    // Height: grayscale height field; push along its gradient (steepest ascent).
    // pixelScale compensates for the map render's dpr: adjacent device pixels are
    // 1/pixelScale screen-px apart, so a denser (retina) map render would otherwise
    // measure a shallower gradient per screen-px than a dpr-1 render. Sampling `step`
    // device px apart and multiplying by pixelScale keeps the gradient a slope per
    // screen-px regardless of render dpr.
    const height = toHeightPixels(map, spec.invert ?? false)
    const step = Math.max(1, Math.round(pixelScale))
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = x - step > 0 ? x - step : 0
        const xr = x + step < w - 1 ? x + step : w - 1
        const yt = y - step > 0 ? y - step : 0
        const yb = y + step < h - 1 ? y + step : h - 1
        const hl = height[(y * w + xl) * 4]!
        const hr = height[(y * w + xr) * 4]!
        const ht = height[(yt * w + x) * 4]!
        const hb = height[(yb * w + x) * 4]!
        const gx = ((hr - hl) * pixelScale) / (255 * ((xr - xl) || 1))
        const gy = ((hb - ht) * pixelScale) / (255 * ((yb - yt) || 1))
        const p = (y * w + x) * 4
        const a = map[p + 3]! / 255
        const o = (y * w + x) * 2
        field[o] = gx * a
        field[o + 1] = gy * a
      }
    }
  }

  const soft = Math.round(spec.softness ?? 0)
  if (soft >= 1) blurFieldInPlace(field, w, h, soft)
  return field
}

/** Separable box blur of the interleaved (dx,dy) field, radius r px, edge-clamped. In place. */
function blurFieldInPlace(field: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(field.length)
  // Horizontal pass → tmp.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0, sy = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const cx = Math.min(w - 1, Math.max(0, x + k))
        sx += field[(y * w + cx) * 2]!; sy += field[(y * w + cx) * 2 + 1]!; n++
      }
      tmp[(y * w + x) * 2] = sx / n; tmp[(y * w + x) * 2 + 1] = sy / n
    }
  }
  // Vertical pass → field.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0, sy = 0, n = 0
      for (let k = -r; k <= r; k++) {
        const cy = Math.min(h - 1, Math.max(0, y + k))
        sx += tmp[(cy * w + x) * 2]!; sy += tmp[(cy * w + x) * 2 + 1]!; n++
      }
      field[(y * w + x) * 2] = sx / n; field[(y * w + x) * 2 + 1] = sy / n
    }
  }
}

/**
 * Resample a backdrop through an offset field. For each output pixel:
 *   sampleUV = (x,y) + field*amount, edge-clamped, bilinear.
 * amount is in the same px space as the src buffer (device px at render time).
 * amount 0 returns the source byte-identical.
 */
export function resampleBilinear(
  src: Uint8ClampedArray,
  field: Float32Array,
  amount: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  const sample = (sxRaw: number, syRaw: number, ch: number): number => {
    const sx = sxRaw < 0 ? 0 : sxRaw > w - 1 ? w - 1 : sxRaw
    const sy = syRaw < 0 ? 0 : syRaw > h - 1 ? h - 1 : syRaw
    const x0 = Math.floor(sx), y0 = Math.floor(sy)
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
    const fx = sx - x0, fy = sy - y0
    const i00 = (y0 * w + x0) * 4 + ch, i10 = (y0 * w + x1) * 4 + ch
    const i01 = (y1 * w + x0) * 4 + ch, i11 = (y1 * w + x1) * 4 + ch
    const top = src[i00]! * (1 - fx) + src[i10]! * fx
    const bot = src[i01]! * (1 - fx) + src[i11]! * fx
    return top * (1 - fy) + bot * fy
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fo = (y * w + x) * 2
      const sx = x + field[fo]! * amount
      const sy = y + field[fo + 1]! * amount
      const po = (y * w + x) * 4
      out[po] = sample(sx, sy, 0)
      out[po + 1] = sample(sx, sy, 1)
      out[po + 2] = sample(sx, sy, 2)
      out[po + 3] = sample(sx, sy, 3)
    }
  }
  return out
}
