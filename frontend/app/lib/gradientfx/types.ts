// Gradient Studio — the serializable config that fully describes a gradient.
// One GradientConfig is the single source of truth: it lives in the node's
// data.properties.comfynext_gradientStudio blob, drives the renderer, and (given
// the same seed + locks) reproduces an identical image.

export type LayoutKind = 'linear' | 'radial' | 'orbit'
export type ShapeKind = 'bands' | 'pyramid' | 'wave' | 'noise'
export type MappingKind = 'across' | 'perbar' | 'field'
export type Direction = 'up' | 'right' | 'down' | 'left'
export type MirrorKind = 'none' | 'horizontal' | 'vertical' | 'both'
export type GradientDir = 'vertical' | 'horizontal'
export type BlendKind = 'normal' | 'lighten' | 'screen' | 'add' | 'multiply' | 'darken' | 'overlay'

export interface ColorStop {
  /** Hex color, e.g. "#ff3b3b". */
  color: string
  /** Position along the ramp, 0..1. */
  pos: number
}

export interface ShapeConfig {
  type: ShapeKind
  /** Number of bars / angular slices. */
  count: number
  /** Floor depth so every bar shows at least this much, 0..1. */
  minDepth: number
  /** Envelope exponent — >1 sharpens peaks, <1 flattens. */
  curveExp: number
  /** Per-bar random depth perturbation, 0..1. */
  jitter: number
  /** Wave: number of peaks across the field. */
  peaks: number
  /** Wave: phase offset, 0..1 (animatable). */
  phase: number
  /** Noise: octave detail, 1..8. */
  detail: number
  /** Noise/Radial: angular sweep in degrees (radial/orbit), 0..360. */
  sweep: number
  /** Rotation / scrub offset, 0..1 (animatable). */
  scrub: number
  /** Gap between bars, 0..1. */
  gap: number
  /** Bar-cap rounding, 0 (square) .. 1 (round). */
  rounding: number
  /** Fill direction (linear). */
  direction: Direction
  /** Mirror the image: none / horizontal / vertical / both. */
  mirror: MirrorKind
  /** Pyramid: position of the valley/peak, 0..1. */
  valley: number
}

export interface ColorConfig {
  stops: ColorStop[]
  /** Gradient ramp axis: vertical (up-down) or horizontal (left-right). */
  gradientDir: GradientDir
  mapping: MappingKind
  /** Quantize the ramp into N bands; 0 = continuous. */
  steps: number
  /** Hue rotation across the field, degrees. */
  hueDrift: number
  /** Global hue rotation, degrees. */
  hueRotate: number
}

export interface LayerConfig {
  blend: BlendKind
  opacity: number
  shape: ShapeConfig
  color: ColorConfig
}

export interface CanvasConfig {
  /** "14:9", "16:9", "1:1", … */
  aspect: string
  layout: LayoutKind
  /** Outer margin, 0..0.45. */
  margin: number
  /** Radial inner radius (hole), 0..0.9. */
  innerRadius: number
  /** Background hex. */
  background: string
}

export interface ReliefConfig {
  /** Film-grain amount, 0..1. */
  grain: number
  /** Relief shading amount, 0..1. */
  relief: number
}

export type EasingKind = 'linear' | 'pingpong' | 'easeinout'

export interface MotionTrack {
  /** Which layer the param belongs to (0 or 1). */
  layer: number
  /** Animatable param key — see ANIMATABLE in motion.ts. */
  param: string
  from: number
  to: number
  easing: EasingKind
  /** Cycles within the clip. */
  loops: number
  /** Hold at extremes, 0..0.5. */
  hold: number
  /** Phase offset into the cycle, 0..1. */
  cycleOffset: number
  /** Start delay, seconds. */
  delay: number
}

export interface MotionConfig {
  tracks: MotionTrack[]
  duration: number
  fps: number
  /** Export height base (1080 / 1440 / 2160). */
  size: number
}

export interface GradientConfig {
  /** Short hash string, e.g. "#b061ca8z". */
  seed: string
  canvas: CanvasConfig
  relief: ReliefConfig
  /** 1 or 2 layers. */
  layers: LayerConfig[]
  motion: MotionConfig
  /** Field lock flags (lock keys: 'aspect','layout','colours','structure',…). */
  locks: Record<string, boolean>
}

export const ASPECTS = ['14:9', '16:9', '9:16', '1:1', '4:5', '3:2', '21:9'] as const
export const BLEND_MODES: BlendKind[] = ['normal', 'lighten', 'screen', 'add', 'multiply', 'darken', 'overlay']
export const SHAPE_KINDS: ShapeKind[] = ['bands', 'wave', 'noise', 'pyramid']
export const LAYOUTS: LayoutKind[] = ['linear', 'radial', 'orbit']
export const MAPPINGS: MappingKind[] = ['across', 'perbar', 'field']
export const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left']
export const MIRROR_KINDS: MirrorKind[] = ['none', 'horizontal', 'vertical', 'both']
export const GRADIENT_DIRS: GradientDir[] = ['vertical', 'horizontal']

export function aspectRatio(a: string): number {
  const [w, h] = a.split(':').map(Number)
  return w && h ? w / h : 1
}

/**
 * Deep-clone a GradientConfig (or any sub-tree). GradientConfig is pure JSON
 * data, so JSON round-trip is safe — and unlike structuredClone it works on Vue
 * reactive proxies (structuredClone throws DataCloneError on a Proxy).
 */
export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
