import type { ClipFilters } from './types'

// Per-clip color adjust — the REFERENCE implementation of the ClipFilters
// semantics documented in types.ts. Three consumers must match it exactly:
//   • the GLSL block in app/lib/engine/gl/shaders.ts,
//   • the Python twin _apply_filters_np in comfy_extras/nodes_timeline.py,
// with parity enforced by mirrored unit tests + the 06-filters golden fixture.
//
// Pipeline (sRGB, clamp to [0,1] after each step):
//   1. brightness: c + b                       (additive, b ∈ −1..1)
//   2. contrast:   (c − 0.5)·k + 0.5           (k ∈ 0.., pivot 0.5)
//   3. saturation: luma + (c − luma)·s         (Rec.709 luma)
//   4. hue:        SVG feColorMatrix hueRotate (luma consts 0.213/0.715/0.072)
//   5. temperature: r·(1 + 0.2t), b·(1 − 0.2t) (t ∈ −1..1, g unchanged)

export const LUMA_709 = [0.2126, 0.7152, 0.0722] as const
export const HUE_LUMA = [0.213, 0.715, 0.072] as const
export const TEMPERATURE_GAIN = 0.2

export function isIdentityFilters(f: ClipFilters | undefined | null): boolean {
  if (!f) return true
  return (f.brightness ?? 0) === 0
    && (f.contrast ?? 1) === 1
    && (f.saturation ?? 1) === 1
    && (f.hue ?? 0) === 0
    && (f.temperature ?? 0) === 0
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** SVG hueRotate matrix rows for angle `rad` (row-major, applied to [r,g,b]). */
export function hueRotateMatrix(rad: number): number[] {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const [lr, lg, lb] = HUE_LUMA
  return [
    lr + c * (1 - lr) + s * (-lr), lg + c * (-lg) + s * (-lg), lb + c * (-lb) + s * (1 - lb),
    lr + c * (-lr) + s * (0.143), lg + c * (1 - lg) + s * (0.140), lb + c * (-lb) + s * (-0.283),
    lr + c * (-lr) + s * (-(1 - lr)), lg + c * (-lg) + s * (lg), lb + c * (1 - lb) + s * (lb),
  ]
}

/** Apply ClipFilters to one sRGB pixel ([0,1] each). Reference impl. */
export function applyFiltersRGB(rgb: readonly [number, number, number], f: ClipFilters | undefined | null): [number, number, number] {
  if (isIdentityFilters(f)) return [rgb[0], rgb[1], rgb[2]]
  let [r, g, b] = rgb

  const br = f!.brightness ?? 0
  r = clamp01(r + br); g = clamp01(g + br); b = clamp01(b + br)

  const k = f!.contrast ?? 1
  r = clamp01((r - 0.5) * k + 0.5); g = clamp01((g - 0.5) * k + 0.5); b = clamp01((b - 0.5) * k + 0.5)

  const s = f!.saturation ?? 1
  const luma = LUMA_709[0] * r + LUMA_709[1] * g + LUMA_709[2] * b
  r = clamp01(luma + (r - luma) * s); g = clamp01(luma + (g - luma) * s); b = clamp01(luma + (b - luma) * s)

  const hueDeg = f!.hue ?? 0
  if (hueDeg !== 0) {
    const m = hueRotateMatrix((hueDeg * Math.PI) / 180)
    const nr = m[0]! * r + m[1]! * g + m[2]! * b
    const ng = m[3]! * r + m[4]! * g + m[5]! * b
    const nb = m[6]! * r + m[7]! * g + m[8]! * b
    r = clamp01(nr); g = clamp01(ng); b = clamp01(nb)
  }

  const t = f!.temperature ?? 0
  if (t !== 0) {
    r = clamp01(r * (1 + TEMPERATURE_GAIN * t))
    b = clamp01(b * (1 - TEMPERATURE_GAIN * t))
  }

  return [r, g, b]
}
