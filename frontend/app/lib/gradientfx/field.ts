// Structure field: turn a ShapeConfig into a 1-D array of bar depths (0..1).
// The renderer uploads this as an N×1 data texture and samples it per pixel.

import { makeRng } from './rng'
import type { ShapeConfig } from './types'

const TAU = Math.PI * 2

/** Smooth 1-D value noise with fractal octaves (deterministic from `seed`). */
function fbm(x: number, octaves: number, seed: string): number {
  const rng = makeRng(seed, 'fbm')
  // Precompute a small gradient lattice; hash lattice points via rng draws.
  const lattice: number[] = []
  for (let i = 0; i < 257; i++) lattice.push(rng.next())
  const at = (i: number) => lattice[((i % 257) + 257) % 257]!
  let sum = 0, amp = 0.5, freq = 1
  for (let o = 0; o < octaves; o++) {
    const xf = x * freq
    const i0 = Math.floor(xf)
    const f = xf - i0
    const u = f * f * (3 - 2 * f) // smoothstep
    const v = at(i0) * (1 - u) + at(i0 + 1) * u
    sum += v * amp
    amp *= 0.5
    freq *= 2
  }
  return sum / (1 - Math.pow(0.5, octaves)) // normalize toward 0..1
}

/**
 * Build the per-bar depth array. Length = clamped count. Each value is the bar's
 * fill amount in [0,1]. Pure + deterministic given the shape + seed.
 */
export function buildField(shape: ShapeConfig, seed: string): Float32Array {
  const count = Math.max(1, Math.min(256, Math.round(shape.count)))
  const out = new Float32Array(count)
  const jitterRng = makeRng(seed, 'jitter')
  const minD = clamp01(shape.minDepth)
  const exp = Math.max(0.05, shape.curveExp || 1)

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5 // 0..1 across the field
    let base: number

    switch (shape.type) {
      case 'pyramid': {
        // Triangular envelope peaking at `valley` (really the peak position).
        const peak = clamp01(shape.valley)
        base = t <= peak
          ? (peak > 0 ? t / peak : 1)
          : (peak < 1 ? (1 - t) / (1 - peak) : 1)
        break
      }
      case 'wave': {
        // Stacked sine peaks; phase shifts the whole field (animatable).
        const peaks = Math.max(0.25, shape.peaks || 1)
        const ph = (shape.phase || 0) * TAU
        base = 0.5 + 0.5 * Math.sin(t * peaks * TAU + ph)
        break
      }
      case 'noise': {
        const octaves = Math.max(1, Math.min(8, Math.round(shape.detail || 3)))
        // scrub scrolls the noise field (animatable).
        base = fbm(t * (shape.peaks || 4) + (shape.scrub || 0) * 8, octaves, seed)
        break
      }
      default:
        base = 0.5
    }

    base = Math.pow(clamp01(base), exp)
    if (shape.jitter) base += (jitterRng.next() - 0.5) * shape.jitter
    out[i] = clamp01(minD + (1 - minD) * clamp01(base))
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
