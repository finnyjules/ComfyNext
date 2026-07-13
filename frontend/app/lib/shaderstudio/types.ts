// frontend/app/lib/shaderstudio/types.ts
// Config for the Shader Studio node — a frontend-only, input-driven studio that
// stacks shader passes over an input image. Persisted at
// node.data.properties.sailor_shaderStudio.

export type EasingKind = 'linear' | 'pingpong' | 'easeinout'

export interface StudioSource {
  kind: 'none' | 'upload' | 'asset'
  /** data: URL for an uploaded image. */
  dataUrl?: string
  /** Asset filename (served via /view) when picked from project Assets. */
  asset?: string
}

export interface StudioEffect {
  /** shaderfx catalog effect id, or '' for none. */
  id: string
  /** non-default uniform overrides for the effect. */
  params: Record<string, number>
  enabled: boolean
  /** ASCII effect, "Custom" shape: characters the user rasterizes into glyphs. */
  customChars?: string
}

export interface StudioDuotone {
  enabled: boolean
  ink: string   // dark color (hex)
  paper: string // light color (hex)
}

/** One color stop on the gradient-map ramp (pos 0..1 = luminance). */
export interface StudioGradientStop { pos: number; color: string }

export interface StudioGradientMap {
  enabled: boolean
  /** Ramp stops (sorted by pos at compose time); max 8 used. */
  stops: StudioGradientStop[]
  mix: number // [0,1] blend of the mapped result over the source
}

export interface StudioAdjust {
  enabled: boolean
  exposure: number     // [-2,2] stops
  brightness: number   // [-1,1]
  contrast: number     // [-1,1]
  saturation: number   // [-1,1]
  hue: number          // [-180,180] degrees
  temperature: number  // [-1,1]
  tint: number         // [-1,1]
}

export interface StudioBlur {
  enabled: boolean
  focusX: number   // [0,1]
  focusY: number   // [0,1]
  range: number    // [0,1] sharp radius (uv distance)
  aperture: number // [0,1] falloff softness
  maxBlur: number  // px at full blur
}

export interface StudioChromatic {
  enabled: boolean
  amount: number // [0,1]
}

export interface StudioBloom {
  enabled: boolean
  threshold: number // [0,1] brightness cutoff that glows
  intensity: number // [0,3] glow strength added back
  radius: number    // px spread of the glow
}

export interface StudioPost {
  blur: StudioBlur
  chromatic: StudioChromatic
  bloom: StudioBloom
}

export interface MotionTrack {
  /** dotted config path to a numeric leaf, e.g. 'adjust.exposure', 'effect.params.u_size'. */
  path: string
  from: number
  to: number
  easing: EasingKind
  loops: number
  delay: number
  hold: number
  cycleOffset: number
}

export interface StudioMotion {
  duration: number // seconds
  fps: number
  tracks: MotionTrack[]
}

export interface ShaderStudioConfig {
  version: number
  source: StudioSource
  /** long-edge cap (px) for preview/export sizing. */
  resolution: number
  effect: StudioEffect
  duotone: StudioDuotone
  gradientMap: StudioGradientMap
  adjust: StudioAdjust
  post: StudioPost
  motion: StudioMotion
}

export function defaultConfig(): ShaderStudioConfig {
  return {
    version: 1,
    source: { kind: 'none' },
    resolution: 1536,
    effect: { id: '', params: {}, enabled: true, customChars: '' },
    duotone: { enabled: false, ink: '#1a1a2e', paper: '#f5f5f5' },
    gradientMap: {
      enabled: false, mix: 1,
      stops: [
        { pos: 0, color: '#06283d' },
        { pos: 0.5, color: '#256d85' },
        { pos: 1, color: '#47b5ff' },
      ],
    },
    adjust: {
      enabled: false, exposure: 0, brightness: 0, contrast: 0,
      saturation: 0, hue: 0, temperature: 0, tint: 0,
    },
    post: {
      blur: { enabled: false, focusX: 0.5, focusY: 0.5, range: 0.2, aperture: 0.25, maxBlur: 8 },
      chromatic: { enabled: false, amount: 0.3 },
      bloom: { enabled: false, threshold: 0.5, intensity: 1.5, radius: 64 },
    },
    motion: { duration: 4, fps: 30, tracks: [] },
  }
}

export function cloneConfig(c: ShaderStudioConfig): ShaderStudioConfig {
  return JSON.parse(JSON.stringify(c))
}

/** Recursively fill any keys missing from a (possibly older) saved config. */
function deepMerge<T>(base: T, over: any): T {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T
  const out: any = { ...(base as any) }
  for (const k of Object.keys(over)) out[k] = deepMerge((base as any)?.[k], over[k])
  return out
}

/** Merge a saved config over current defaults so new fields (e.g. post.bloom) exist. */
export function hydrateConfig(raw: any): ShaderStudioConfig {
  return deepMerge(defaultConfig(), raw)
}

/** Fit (w,h) inside a long-edge cap, preserving aspect, returning even integers. */
export function outputDims(
  srcW: number,
  srcH: number,
  cap: number,
  opts: { upscale?: boolean } = {},
): { w: number; h: number } {
  const long = Math.max(srcW, srcH)
  // Default: `cap` is a downscale ceiling (used by the preview). With upscale,
  // it's a true target long edge — scale smaller sources up to match it.
  const scale = opts.upscale || long > cap ? cap / long : 1
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(srcW * scale), h: even(srcH * scale) }
}
