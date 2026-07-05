// Color-theory harmony engine. Pure; works in OKLCH (perceptually even hue steps
// and lightness). Hex in, hex out at the boundary.
//
//   harmonyHues  — the angular theory (base hue → member hues), exact & testable
//   harmonize    — seed color → harmony swatches (member 0 ≈ the seed)
//   toDuotone    — collapse a harmony into a { shadow, highlight } 2-color duotone
//   toStops      — expand a harmony into N gradient-map stops (dark → light ramp)

import { hexToOklch, oklchToHex } from './convert'

export type HarmonyType =
  | 'monochromatic'
  | 'complementary'
  | 'split-complementary'
  | 'analogous'
  | 'accented-analogous'
  | 'triadic'
  | 'tetradic'
  | 'compound'

export const HARMONY_TYPES: HarmonyType[] = [
  'monochromatic',
  'complementary',
  'split-complementary',
  'analogous',
  'accented-analogous',
  'triadic',
  'tetradic',
  'compound',
]

/** Human-facing labels for the picker. */
export const HARMONY_LABELS: Record<HarmonyType, string> = {
  monochromatic: 'Monochromatic',
  complementary: 'Complementary',
  'split-complementary': 'Split-complementary',
  analogous: 'Analogous',
  'accented-analogous': 'Accented analogous',
  triadic: 'Triadic',
  tetradic: 'Tetradic',
  compound: 'Compound',
}

export interface GradientStop { pos: number; color: string }

/** A named curated palette tagged with its harmony type (see palettes.ts). */
export interface CuratedPalette { name: string; type: HarmonyType; colors: string[] }

/** Natural palette size for each harmony. */
const NATURAL: Record<HarmonyType, number> = {
  monochromatic: 3,
  complementary: 2,
  'split-complementary': 3,
  analogous: 3,
  'accented-analogous': 4,
  triadic: 3,
  tetradic: 4,
  compound: 4,
}

/** Fixed hue offsets (degrees) for the wheel-symmetric harmonies. */
const FIXED: Partial<Record<HarmonyType, number[]>> = {
  complementary: [0, 180],
  'split-complementary': [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  compound: [0, 30, 180, 210],
}

const norm = (h: number) => ((h % 360) + 360) % 360
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Interpolate hue along the shortest arc. */
const lerpHue = (a: number, b: number, t: number) => {
  const d = (((b - a) % 360) + 540) % 360 - 180
  return norm(a + d * t)
}

/** Analogous offsets: 0, +30, -30, +60, -60, … out to `count`. */
function analogousOffsets(count: number): number[] {
  const out = [0]
  let step = 30
  while (out.length < count) {
    out.push(step)
    if (out.length < count) out.push(-step)
    step += 30
  }
  return out.slice(0, count)
}

/** The angular color theory: base hue (deg) → member hues (deg, normalized). */
export function harmonyHues(baseHue: number, type: HarmonyType, count = NATURAL[type]): number[] {
  let offsets: number[]
  if (type === 'monochromatic') offsets = new Array(count).fill(0)
  else if (type === 'analogous') offsets = analogousOffsets(count)
  else if (type === 'accented-analogous') offsets = [...analogousOffsets(Math.max(1, count - 1)), 180]
  else {
    const base = FIXED[type]!
    offsets = Array.from({ length: count }, (_, i) => base[i % base.length]!)
  }
  return offsets.slice(0, count).map(o => norm(baseHue + o))
}

/**
 * Seed color → harmony swatches. Member 0 ≈ the seed; other members share the
 * seed's lightness/chroma and rotate hue by the harmony. Monochromatic is a
 * special case: one hue rendered as a tonal ramp (lightness stepped).
 */
export function harmonize(seedHex: string, type: HarmonyType, count = NATURAL[type]): string[] {
  const [L, C, H] = hexToOklch(seedHex)
  if (type === 'monochromatic') {
    const lo = 0.25, hi = 0.92
    return Array.from({ length: count }, (_, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1)
      const l = lerp(lo, hi, t)
      // ease chroma toward the extremes so very dark/light steps don't clip hard
      const c = Math.max(0.05, C * (1 - Math.abs(t - 0.5) * 0.9))
      return oklchToHex(l, c, H)
    })
  }
  return harmonyHues(H, type, count).map(h => oklchToHex(L, C, h))
}

// Lightness/chroma envelopes for the two effect shapes.
const SHADOW = { L: 0.28, maxC: 0.13 }
const HIGHLIGHT = { L: 0.9, maxC: 0.08 }
const RAMP = { lo: 0.22, hi: 0.92 }

/** Collapse a harmony into a 2-color duotone: first hue → dark, second → light. */
export function toDuotone(hexes: string[]): { shadow: string; highlight: string } {
  const c0 = hexes[0] ?? '#000000'
  const c1 = hexes[1] ?? hexes[0] ?? '#ffffff'
  const [, C0, H0] = hexToOklch(c0)
  const [, C1, H1] = hexToOklch(c1)
  return {
    shadow: oklchToHex(SHADOW.L, Math.min(C0, SHADOW.maxC), H0),
    highlight: oklchToHex(HIGHLIGHT.L, Math.min(C1, HIGHLIGHT.maxC), H1),
  }
}

/**
 * Expand a harmony into `n` gradient-map stops. Hue/chroma are sampled along the
 * harmony sequence while lightness ramps dark → light across the positions, so a
 * gradient map built from it preserves the image's tonal order.
 */
export function toStops(hexes: string[], n: number): GradientStop[] {
  const src = (hexes.length ? hexes : ['#000000', '#ffffff']).map(h => hexToOklch(h))
  const k = src.length
  if (n <= 1) return [{ pos: 0.5, color: oklchToHex(...src[0]!) }]
  const stops: GradientStop[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const f = t * (k - 1)
    const lo = Math.min(k - 1, Math.floor(f))
    const hi = Math.min(k - 1, lo + 1)
    const fr = f - lo
    const C = lerp(src[lo]![1], src[hi]![1], fr)
    const Hh = lerpHue(src[lo]![2], src[hi]![2], fr)
    const L = lerp(RAMP.lo, RAMP.hi, t)
    // keep some chroma but ease it at the light/dark extremes
    const c = Math.max(0.03, C * (1 - Math.abs(t - 0.5) * 0.5))
    stops.push({ pos: t, color: oklchToHex(L, c, Hh) })
  }
  return stops
}
