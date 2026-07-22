/**
 * Post-processing effects for the Compositor — pure kernels + the canvas
 * effect chain shared by per-layer rendering (paintLayer) and the doc-level
 * post stack (paintLayerStack). Spatial params are normalized to canvas
 * width; `opts.W` is the logical width, `opts.scale` device px per logical px.
 *
 * Fixed chain order (applyEffectChain is the single source of truth):
 *   adjust → duotone → bloom → vignette → grain
 */

export interface AdjustEffect {
  type: 'adjust'
  brightness: number  // 1 = neutral, CSS brightness() multiplier, 0..2
  contrast: number    // 1 = neutral, 0..2
  saturation: number  // 1 = neutral, 0..2
  hue: number         // degrees, -180..180, 0 = neutral
  visible: boolean
}
export interface BloomEffect {
  type: 'bloom'
  threshold: number   // 0..1 — luminance cutoff for the bright pass
  radius: number      // blur radius, normalized to canvas width
  intensity: number   // 0..2 — strength of the additive composite
  visible: boolean
}
export interface GrainEffect {
  type: 'grain'
  amount: number      // 0..1 — composite alpha
  size: number        // 1..8 — noise texel scale
  visible: boolean
}
export interface VignetteEffect {
  type: 'vignette'
  amount: number      // 0..1 — darkening strength
  size: number        // 0..1 — inner radius where falloff starts
  softness: number    // 0..1 — falloff width
  visible: boolean
}
export interface DuotoneEffect {
  type: 'duotone'
  shadows: string     // hex colour mapped to luminance 0
  highlights: string  // hex colour mapped to luminance 1
  mix: number         // 0..1 — blend between original and duotone result
  visible: boolean
}
export type PostEffect = AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect

export const POST_EFFECT_DEFAULTS: Record<PostEffect['type'], PostEffect> = {
  adjust: { type: 'adjust', brightness: 1, contrast: 1, saturation: 1, hue: 0, visible: true },
  bloom: { type: 'bloom', threshold: 0.6, radius: 0.02, intensity: 0.8, visible: true },
  grain: { type: 'grain', amount: 0.25, size: 2, visible: true },
  vignette: { type: 'vignette', amount: 0.5, size: 0.5, softness: 0.5, visible: true },
  duotone: { type: 'duotone', shadows: '#1a1a40', highlights: '#ffe8d6', mix: 1, visible: true },
}
export function defaultPostEffect(type: PostEffect['type']): PostEffect {
  return JSON.parse(JSON.stringify(POST_EFFECT_DEFAULTS[type])) as PostEffect
}

/** Shared param bounds — the panel sliders and the agent's sanitizer both obey these. */
export const POST_FX_PARAM_CLAMP: Record<string, Record<string, [number, number]>> = {
  adjust: { brightness: [0, 2], contrast: [0, 2], saturation: [0, 2], hue: [-180, 180] },
  bloom: { threshold: [0, 1], radius: [0, 0.5], intensity: [0, 2] },
  grain: { amount: [0, 1], size: [1, 8] },
  vignette: { amount: [0, 1], size: [0, 1], softness: [0, 1] },
  duotone: { mix: [0, 1] },
}

const CHAIN_TYPES = new Set<string>(['adjust', 'duotone', 'bloom', 'vignette', 'grain'])
export const isChainEffect = (e: { type: string }): boolean => CHAIN_TYPES.has(e.type)
export const chainActive = (effects?: { type: string; visible?: boolean }[]): boolean =>
  !!effects?.some(e => e.visible !== false && CHAIN_TYPES.has(e.type))

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6) // 8-digit hex: strip alpha
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** CSS filter string for an adjust effect — '' when every param is neutral. */
export function adjustFilterString(fx: AdjustEffect): string {
  const b = clamp(fx.brightness ?? 1, 0, 2)
  const c = clamp(fx.contrast ?? 1, 0, 2)
  const s = clamp(fx.saturation ?? 1, 0, 2)
  const h = clamp(fx.hue ?? 0, -180, 180)
  const parts: string[] = []
  if (b !== 1) parts.push(`brightness(${b})`)
  if (c !== 1) parts.push(`contrast(${c})`)
  if (s !== 1) parts.push(`saturate(${s})`)
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`)
  return parts.join(' ')
}

/** Deterministic PRNG bytes (mulberry32) — grain must render identically every
 *  frame/bake or motion sequences shimmer. */
export function noiseBytes(seed: number, count: number): Uint8Array {
  let a = seed >>> 0
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 255
  }
  return out
}

/** Bloom bright pass: zero the alpha of every pixel whose luminance is below
 *  threshold. Hard cutoff — the subsequent blur softens the knee. */
export function brightPassInPlace(data: Uint8ClampedArray, threshold: number): void {
  const t = clamp01(threshold) * 255
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    if (lum < t) data[i + 3] = 0
  }
}

/** Gradient-map RGB toward shadows→highlights by luminance; alpha untouched. */
export function duotoneInPlace(
  data: Uint8ClampedArray,
  shadows: { r: number; g: number; b: number },
  highlights: { r: number; g: number; b: number },
  mix: number,
): void {
  const m = clamp01(mix)
  if (m === 0) return
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    data[i] = data[i]! + (shadows.r + (highlights.r - shadows.r) * lum - data[i]!) * m
    data[i + 1] = data[i + 1]! + (shadows.g + (highlights.g - shadows.g) * lum - data[i + 1]!) * m
    data[i + 2] = data[i + 2]! + (shadows.b + (highlights.b - shadows.b) * lum - data[i + 2]!) * m
  }
}

/** Radial-gradient stops (fractions of the half-diagonal) for a vignette.
 *  softness 0 still keeps a minimal ramp so the edge never bands. */
export function vignetteStops(size: number, softness: number): { inner: number; outer: number } {
  const inner = clamp01(size)
  const outer = Math.min(1.5, inner + Math.max(0.02, clamp01(softness)))
  return { inner, outer }
}
