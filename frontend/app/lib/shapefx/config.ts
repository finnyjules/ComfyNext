import type { HarmonyType } from '../color/harmony'
import { normalizeShaderSpec, type FillType, type ShaderSpec } from '../spacetype/fillTile'

export type ShapeMode = 'primitive' | 'gem'
export type PrimitiveKind =
  | 'cube' | 'sphere' | 'cone' | 'cylinder' | 'prism' | 'torus' | 'icosahedron' | 'octahedron'
export type FillMode = 'facets' | 'surface'
/** How the harmony ramp is painted onto the shape:
 *   prismatic — each facet gets its OWN gradient (anchored in the palette by position,
 *               spread across the facet along a per-facet direction) → cut-gem shimmer
 *   smooth    — per-vertex sample of the interpolated ramp (one gradient sweeps the surface)
 *   faceted   — one flat ramp-tone per facet, progressing smoothly facet-to-facet
 *   ombre     — the ramp rendered with a per-pixel grainy dither (solid → speckle → solid)
 *   scatter   — each facet a random discrete swatch + jitter (the low-poly confetti look) */
export type ColoringMode = 'prismatic' | 'smooth' | 'faceted' | 'ombre' | 'scatter'
/** Which spatial axis the smooth/faceted ramp follows. */
export type ColorDirection = 'vertical' | 'depth' | 'radial' | 'angular'
export type Projection = 'orthographic' | 'perspective'
export type SectionKey = 'shape' | 'palette' | 'style'

export interface ShapeParams {
  mode: ShapeMode
  primitive: PrimitiveKind
  /** Gem mode: number of scattered points (hull complexity). 4–40. */
  vertices: number
  /** Gem mode: elongation along Z, 0.2–2. */
  depth: number
  /** Gem mode: point-cloud spread, 0.1–1. */
  spread: number
  /** Primitive facet density → segment count / detail. 0–4 (integer steps). */
  density: number
  /** Seeded vertex-position jitter, 0–100 (0 = clean primitive; higher = crumpled/organic). */
  jitter: number
  /** Uniform scale of the shape in frame, 0.25–3 (1 = default framing). */
  scale: number
  projection: Projection
}

export interface PaletteParams {
  harmony: HarmonyType
  baseHue: number         // 0–360
  saturation: number      // 0–100
  lightness: number       // 0–100
  coloring: ColoringMode
  direction: ColorDirection // used by smooth & faceted (ignored by scatter)
}

export interface StyleParams {
  grain: number        // 0–100
  distortion: number   // 0–100
  background: string   // '#rrggbb' or 'transparent'
}

export interface SurfaceFill {
  type: FillType
  a: string
  b: string
  angle: number
  density: number
  /** Only meaningful when `type === 'shader'`. Discovered gap (fixed alongside the shader-fill
   *  animation wiring): this field did not exist until now, and `toFill()` in `surface.ts` had
   *  nothing to read even when a caller forced `type: 'shader'` through the picker — so
   *  selecting "shader" in Shape Studio's Fill type dropdown silently degraded to the default
   *  shader input (a plain gradient), never actually reaching the shader renderer, and could
   *  not survive a save/reload either (`shader` wasn't in `FILLTYPES`'s mergeConfig whitelist).
   *  Still no dedicated effect/params PICKER UI for this field (unlike Space Type's fill-swatch
   *  editor) — that remains a separate, larger feature. This is the minimum plumbing needed for
   *  a `ShaderSpec` attached to a Shape Studio fill (via Import Settings JSON, var-bindings, or
   *  a future picker) to actually reach the renderer and persist. */
  shader?: ShaderSpec
}

export interface ShapeConfig {
  seed: string
  fillMode: FillMode
  shape: ShapeParams
  palette: PaletteParams
  fill: SurfaceFill
  style: StyleParams
  locks: Record<SectionKey, boolean>
}

export const DEFAULT_CONFIG: ShapeConfig = {
  seed: '#3a7f21c0',
  fillMode: 'facets',
  shape: { mode: 'primitive', primitive: 'cube', vertices: 14, depth: 1, spread: 0.65, density: 1, jitter: 0, scale: 1, projection: 'orthographic' },
  palette: { harmony: 'analogous', baseHue: 287, saturation: 57, lightness: 47, coloring: 'prismatic', direction: 'vertical' },
  fill: { type: 'gradient', a: '#ff4da6', b: '#6a3df0', angle: 45, density: 8 },
  style: { grain: 20, distortion: 0, background: '#000000' },
  locks: { shape: false, palette: false, style: false },
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : d
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

const MODES = ['primitive', 'gem'] as const
/** The primitive solids, in UI order. Exported so the control schema offers exactly
 *  this set — a second hand-written copy would silently drop any new member. */
export const PRIMS = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron'] as const
const FILLMODES = ['facets', 'surface'] as const
const COLORINGS = ['prismatic', 'smooth', 'faceted', 'ombre', 'scatter'] as const
const DIRECTIONS = ['vertical', 'depth', 'radial', 'angular'] as const
const PROJ = ['orthographic', 'perspective'] as const

// Legacy migration: the shipped v1 used a single `rule` ('facet'|'depth'|'height').
// Map old exported/persisted configs onto the new coloring+direction pair.
const LEGACY_COLORING: Record<string, ColoringMode> = { facet: 'scatter', depth: 'faceted', height: 'faceted' }
const LEGACY_DIRECTION: Record<string, ColorDirection> = { depth: 'depth', height: 'vertical' }
const HARMONIES = ['monochromatic', 'complementary', 'split-complementary', 'analogous', 'accented-analogous', 'triadic', 'tetradic', 'compound'] as const
const FILLTYPES = ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr', 'shader'] as const

/** Deep-merge an untrusted parsed value over DEFAULT_CONFIG so partial/old/junk configs stay safe. */
export function mergeConfig(raw: unknown): ShapeConfig {
  const o = (raw ?? {}) as Record<string, any>
  const d = DEFAULT_CONFIG
  const sh = (o.shape ?? {}) as Record<string, any>
  const pa = (o.palette ?? {}) as Record<string, any>
  const fi = (o.fill ?? {}) as Record<string, any>
  const st = (o.style ?? {}) as Record<string, any>
  const lo = (o.locks ?? {}) as Record<string, any>
  return {
    seed: str(o.seed, d.seed),
    fillMode: oneOf(o.fillMode, FILLMODES, d.fillMode),
    shape: {
      mode: oneOf(sh.mode, MODES, d.shape.mode),
      primitive: oneOf(sh.primitive, PRIMS, d.shape.primitive),
      vertices: num(sh.vertices, d.shape.vertices),
      depth: num(sh.depth, d.shape.depth),
      spread: num(sh.spread, d.shape.spread),
      density: num(sh.density, d.shape.density),
      jitter: num(sh.jitter, d.shape.jitter),
      scale: num(sh.scale, d.shape.scale),
      projection: oneOf(sh.projection, PROJ, d.shape.projection),
    },
    palette: {
      harmony: oneOf(pa.harmony, HARMONIES, d.palette.harmony),
      baseHue: num(pa.baseHue, d.palette.baseHue),
      saturation: num(pa.saturation, d.palette.saturation),
      lightness: num(pa.lightness, d.palette.lightness),
      coloring: oneOf(pa.coloring, COLORINGS, LEGACY_COLORING[pa.rule] ?? d.palette.coloring),
      direction: oneOf(pa.direction, DIRECTIONS, LEGACY_DIRECTION[pa.rule] ?? d.palette.direction),
    },
    fill: (() => {
      const fillType = oneOf(fi.type, FILLTYPES, d.fill.type)
      return {
        type: fillType,
        a: str(fi.a, d.fill.a),
        b: str(fi.b, d.fill.b),
        angle: num(fi.angle, d.fill.angle),
        density: num(fi.density, d.fill.density),
        // A spec on a non-shader fill is dropped, same rule normalizeFill's own shader
        // branch follows — reuses its sanitizer rather than a second hand-rolled one.
        shader: fillType === 'shader' ? normalizeShaderSpec(fi.shader, 0) : undefined,
      }
    })(),
    style: {
      grain: num(st.grain, d.style.grain),
      distortion: num(st.distortion, d.style.distortion),
      background: str(st.background, d.style.background),
    },
    locks: {
      shape: bool(lo.shape, d.locks.shape),
      palette: bool(lo.palette, d.locks.palette),
      style: bool(lo.style, d.locks.style),
    },
  }
}
