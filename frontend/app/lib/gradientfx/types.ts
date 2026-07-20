// Gradient Studio — the serializable config that fully describes a gradient.
// One GradientConfig is the single source of truth: it lives in the node's
// data.properties.sailor_gradientStudio blob, drives the renderer, and (given
// the same seed + locks) reproduces an identical image.

import { defaultMesh } from './mesh'
import type { BlendKind } from '~/lib/studio/blend'
export { type BlendKind, BLEND_MODES } from '~/lib/studio/blend'

/** Maximum number of stacked layers the render core composites. */
export const LAYER_MAX = 6

export type LayoutKind = 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid' | 'mesh'
export type ShapeKind = 'bands' | 'pyramid' | 'wave' | 'noise'
export type RingShape = 'circle' | 'diamond' | 'square'
export type MappingKind = 'across' | 'perbar' | 'field'
export type Direction = 'up' | 'right' | 'down' | 'left'
export type MirrorKind = 'none' | 'horizontal' | 'vertical' | 'both'
export type GradientDir = 'vertical' | 'horizontal'

export interface ColorStop {
  /** Hex color, e.g. "#ff3b3b". */
  color: string
  /** Position along the ramp, 0..1. */
  pos: number
}

export interface LightConfig {
  /** Light azimuth, degrees (0..360) — direction the light comes from in the screen plane. */
  azimuth: number
  /** Light elevation, degrees (0..90) — 90 = head-on, low = raking light. */
  elevation: number
}

export interface CenterOffset {
  /** Radial/orbit origin X offset, -0.5..0.5 (0 = centered). */
  x: number
  /** Radial/orbit origin Y offset, -0.5..0.5 (0 = centered). */
  y: number
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
  /** Stack layout: gradient rotation added per ring, degrees (optional, back-compat). */
  rotStep?: number
  /** Stack layout: per-ring center orbit, 0 (concentric) .. 1 (off-center spiral). */
  pivot?: number
  /** Stack layout: disc size multiplier, 1 = touches edges, >1 bleeds past to fill the frame. */
  ringScale?: number
  /** Stack layout: ring contour — circle / diamond / square (optional, defaults to circle). */
  ringShape?: RingShape
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

/** One color control point of a mesh gradient — position in 0..1, hex color. */
export interface MeshPoint {
  x: number
  y: number
  color: string
}

export interface MeshConfig {
  /** Color control points (2..MESH_MAX_POINTS); each bleeds softly into the rest. */
  points: MeshPoint[]
  /** Gaussian bleed radius, 0..100 (low = tight blobs, high = washy). */
  softness: number
  /** Zone sharpness, 0..100 — blends the smooth mesh toward crisp Voronoi cells (kills mud). */
  contrast: number
  /** Post blur, 0..100 — multi-tap gaussian over the mesh field for a dreamy soft wash. */
  blur?: number
  /** Living-drift orbit amount, 0..100. 0 = static. */
  drift: number
}

export interface LayerConfig {
  blend: BlendKind
  opacity: number
  shape: ShapeConfig
  color: ColorConfig
  /** Mesh-layout points (only layer 0, only when canvas.layout === 'mesh'). */
  mesh?: MeshConfig
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
  /** Radial/orbit origin offset (optional for back-compat; defaults to {0,0}). */
  center?: CenterOffset
}

export interface ReliefConfig {
  /** Film-grain amount, 0..1. */
  grain: number
  /** Relief shading amount, 0..1. */
  relief: number
  /** Directional light for the 3D emboss (optional for back-compat; defaults to DEFAULT_LIGHT). */
  light?: LightConfig
}

export interface FlowConfig {
  /** Base gradient direction (liquid) + warp bias, degrees 0..360. */
  angle: number
  /** Warp noise frequency, ~0.5..8. */
  noiseScale: number
  /** Displacement amount, 0..100. 0 = off (no distortion). */
  intensity: number
  /** Iterative curl / "Curve Distortion", 0..100. */
  distortion: number
  /** fbm octaves, 1..6. */
  detail: number
  /** Liquid fold-shading emboss amplitude, 0..100. */
  depth: number
  /** Liquid fold-shading bright-side gain, 0..100. */
  highlights: number
  /** Liquid fold-shading dark-side gain, 0..100. */
  shadows: number
  /** Liquid fold frequency, 0..100. */
  foldScale: number
  /** Living-drift animation speed, 0..100. 0 = static (orbits the warp field over the loop). */
  speed?: number
  /** Liquid specular gloss / wet sheen, 0..100. 0 = matte. */
  gloss?: number
  /** Liquid marbled veins, 0..100 — bands the flow into ink/oil tendrils (0 = smooth smoke). */
  veins?: number
  /** Vein frequency, 0..100 — how tightly packed the marble veins are. */
  veinScale?: number
  /** Wet-surface ripple/caustic shimmer, 0..100. 0 = none. */
  ripple?: number
  /** Glassy chromatic refraction, 0..100 — bends + splits the gradient like thick liquid. */
  refract?: number
  /** Viscosity, 0..100 — compresses the warp along the flow into laminar streaks (vs turbulent billow). */
  viscosity?: number
  /** Swirl, 0..100 — extra recursive warp passes + amplitude for gnarlier curls (more warp). 0 = base. */
  swirl?: number
}

export type EasingKind = 'linear' | 'pingpong' | 'easeinout'

export interface MotionTrack {
  /** Which layer the param belongs to (0..LAYER_MAX-1). */
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

/** Which region stays in focus while the rest blurs. `off` = uniform soft-focus
 *  (blur everything evenly, no focus point). */
export type FocusShape = 'off' | 'radial' | 'linear'

/** Optical soft-focus / depth-of-field post stage. A global blur amount plus an
 *  optional in-focus region whose blur ramps up with distance (radial spot or
 *  angled tilt-shift band). `blur === 0` is a byte-identical no-op. */
export interface FocusConfig {
  /** Blur amount 0..100. 0 = sharp (post stage skipped entirely). */
  blur: number
  shape: FocusShape
  /** Focus centre, normalized −0.5..0.5 (0,0 = middle). */
  x: number
  y: number
  /** In-focus region size, 0..1 (radial: radius; linear: band half-width). */
  radius: number
  /** Falloff 0..100 — how gradually blur ramps in past the focus region. */
  softness: number
  /** Linear band angle, degrees 0..360 (ignored for radial/off). */
  angle: number
}

export const DEFAULT_FOCUS: FocusConfig = { blur: 0, shape: 'off', x: 0, y: 0, radius: 0.25, softness: 40, angle: 0 }

export interface GradientConfig {
  /** Short hash string, e.g. "#b061ca8z". */
  seed: string
  canvas: CanvasConfig
  relief: ReliefConfig
  /** 1..LAYER_MAX layers. */
  layers: LayerConfig[]
  motion: MotionConfig
  /** Field lock flags (lock keys: 'aspect','layout','colors','structure',…). */
  locks: Record<string, boolean>
  /** Domain-warp / liquid flow (optional for back-compat; defaults to DEFAULT_FLOW). */
  flow?: FlowConfig
  /** Optical soft-focus / DoF (optional for back-compat; defaults to DEFAULT_FOCUS = off). */
  focus?: FocusConfig
}

export const ASPECTS = ['14:9', '16:9', '9:16', '1:1', '4:5', '3:2', '21:9'] as const
export const SHAPE_KINDS: ShapeKind[] = ['bands', 'wave', 'noise', 'pyramid']
export const LAYOUTS: LayoutKind[] = ['linear', 'radial', 'orbit', 'stack', 'liquid', 'mesh']
export const RING_SHAPES: RingShape[] = ['circle', 'diamond', 'square']
export const MAPPINGS: MappingKind[] = ['across', 'perbar', 'field']
export const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left']
export const MIRROR_KINDS: MirrorKind[] = ['none', 'horizontal', 'vertical', 'both']
export const GRADIENT_DIRS: GradientDir[] = ['vertical', 'horizontal']

export function aspectRatio(a: string): number {
  const [w, h] = a.split(':').map(Number)
  return w && h ? w / h : 1
}

/** Default light: upper-left, mid elevation — flattering emboss. */
export const DEFAULT_LIGHT: LightConfig = { azimuth: 135, elevation: 45 }
/** Default origin: centered. */
export const DEFAULT_CENTER: CenterOffset = { x: 0, y: 0 }
/** Default flow: no distortion (intensity 0) so existing gradients are unchanged. */
export const DEFAULT_FLOW: FlowConfig = {
  angle: 45, noiseScale: 3.5, intensity: 0, distortion: 50, detail: 2,
  depth: 60, highlights: 50, shadows: 55, foldScale: 60, speed: 0, gloss: 0,
  veins: 0, veinScale: 35, ripple: 0, refract: 0, viscosity: 0, swirl: 0,
}

/** Flow block with the default applied when a config omits it. */
export function flowConfig(cfg: GradientConfig): FlowConfig {
  return cfg.flow ?? DEFAULT_FLOW
}

/**
 * Convert azimuth/elevation (degrees) to a normalized 3D light direction.
 * x/y lie in the screen plane (y up), z points out toward the viewer.
 * azimuth 0 → +X, azimuth 90 → +Y, elevation 90 → +Z.
 */
export function lightVector(azimuth: number, elevation: number): [number, number, number] {
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  const cz = Math.cos(el)
  return [cz * Math.cos(az), cz * Math.sin(az), Math.sin(el)]
}

/** Light direction with the default applied when a config omits it. */
export function reliefLight(relief: ReliefConfig): LightConfig {
  return relief.light ?? DEFAULT_LIGHT
}

/** Center offset with the default applied when a config omits it. */
export function canvasCenter(canvas: CanvasConfig): CenterOffset {
  return canvas.center ?? DEFAULT_CENTER
}

/**
 * Backfill optional fields added after the original schema so persisted node
 * blobs keep working. Mutates `cfg` in place and returns it.
 */
export function ensureConfigDefaults(cfg: GradientConfig): GradientConfig {
  // Defensive: a malformed/partial blob (e.g. a corrupt node or an empty {}) must
  // not throw — backfill the top-level containers before reading into them.
  cfg.canvas = cfg.canvas ?? ({} as GradientConfig['canvas'])
  if (!cfg.canvas.center) cfg.canvas.center = { ...DEFAULT_CENTER }
  cfg.relief = cfg.relief ?? ({} as GradientConfig['relief'])
  if (!cfg.relief.light) cfg.relief.light = { ...DEFAULT_LIGHT }
  if (!cfg.flow) cfg.flow = { ...DEFAULT_FLOW }
  if (cfg.flow.speed == null) cfg.flow.speed = 0
  if (cfg.flow.gloss == null) cfg.flow.gloss = 0
  // Backfill focus (merge so a partial object — e.g. an agent patch that set only
  // focus.blur — gets the rest of the defaults, keeping the editor bindings non-null).
  cfg.focus = { ...DEFAULT_FOCUS, ...(cfg.focus ?? {}) }
  cfg.layers = cfg.layers ?? []
  // A mesh-layout config must carry mesh points on layer 0 (the renderer falls back
  // too, but backfilling here keeps the editor's bindings non-null).
  if (cfg.canvas.layout === 'mesh' && cfg.layers[0]?.color?.stops && !cfg.layers[0].mesh) {
    cfg.layers[0].mesh = defaultMesh(cfg.layers[0].color.stops, cfg.seed)
  }
  return cfg
}

/**
 * Deep-clone a GradientConfig (or any sub-tree). GradientConfig is pure JSON
 * data, so JSON round-trip is safe — and unlike structuredClone it works on Vue
 * reactive proxies (structuredClone throws DataCloneError on a Proxy).
 */
export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
