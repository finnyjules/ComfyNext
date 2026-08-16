/**
 * geologo config — the 2D-vector clone-and-arrange logo generator's schema.
 *
 * Dependency-light on purpose (see the module import list below): this file
 * sits under Shape Studio's dynamic-import chain, same posture as
 * `shapefx/config.ts`, and must not drag in `three` or `paper`.
 */
import type { BaseShapeKind } from './shapes'
import type { VectorPaint, VectorGradient, VectorPattern } from '~/lib/vector/svg'

export type GeoLayout = 'radial' | 'grid' | 'linear'
export type GeoFillMode = 'evenodd' | 'unite' | 'subtract' | 'intersect' | 'exclude'
/** How overlapping clones resolve where they cross:
 *   hole  — evenodd-style cut, the overlap reads as a hole through both shapes
 *   shape — the overlap is painted as its own region, in `overlapFill` */
export type GeoOverlapMode = 'hole' | 'shape'
export type GeoSymmetryAxis = 'vertical' | 'horizontal'
export type GeoClipMask = 'none' | 'circle' | 'square' | 'hexagon'

export interface GeoShapeConfig {
  shape: BaseShapeKind
  sides: number
  starInner: number
  irregularSeed: number
  size: number
  count: number
  layout: GeoLayout
  radius: number
  spacing: number
  angleStep: number
  rotateBase: number
  rotateStep: number
  scaleStart: number
  scaleEnd: number
  skew: number
  spin: number
  fillMode: GeoFillMode
  overlapMode: GeoOverlapMode
  roundCorners: number
  roundRadius: number
  symmetry: boolean
  symmetryAxis: GeoSymmetryAxis
  symmetrySpacing: number
  clipMask: GeoClipMask
  clipMaskSize: number
  invert: boolean
  padding: number
  strokeWidth: number
  seed: number
  fill: VectorPaint
  stroke: string | null
  /** Used only when overlapMode === 'shape'. */
  overlapFill: VectorPaint
  gridCols: number
  gridRows: number
  locks: Record<string, boolean>
}

export const DEFAULT_CONFIG: GeoShapeConfig = {
  shape: 'hexagon',
  sides: 6,
  starInner: 0.45,
  irregularSeed: 1,
  size: 180,
  count: 6,
  layout: 'radial',
  radius: 120,
  spacing: 220,
  angleStep: 60,
  rotateBase: 0,
  rotateStep: 0,
  scaleStart: 1,
  scaleEnd: 1,
  skew: 0,
  spin: 0,
  fillMode: 'evenodd',
  overlapMode: 'hole',
  roundCorners: 0,
  roundRadius: 0,
  symmetry: false,
  symmetryAxis: 'vertical',
  symmetrySpacing: 0,
  clipMask: 'none',
  clipMaskSize: 100,
  invert: false,
  padding: 40,
  strokeWidth: 8,
  seed: 1,
  fill: '#111111',
  stroke: null,
  overlapFill: '#111111',
  gridCols: 3,
  gridRows: 2,
  locks: {},
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : d
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
/** Clamp a numeric field into [min, max] (rounded) so junk input can't blow up an O(n²) fold. */
const clampNum = (v: unknown, d: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(num(v, d))))

const SHAPES = ['polygon', 'star', 'hexagon', 'irregular'] as const
const LAYOUTS = ['radial', 'grid', 'linear'] as const
const FILLMODES = ['evenodd', 'unite', 'subtract', 'intersect', 'exclude'] as const
const OVERLAPMODES = ['hole', 'shape'] as const
const SYMMETRY_AXES = ['vertical', 'horizontal'] as const
const CLIP_MASKS = ['none', 'circle', 'square', 'hexagon'] as const

/** A well-formed gradient stop: finite offset, string colour. */
function isValidGradientStop(s: unknown): s is { offset: number; color: string; opacity?: number } {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  if (typeof o.offset !== 'number' || !Number.isFinite(o.offset)) return false
  if (typeof o.color !== 'string') return false
  if (o.opacity !== undefined && (typeof o.opacity !== 'number' || !Number.isFinite(o.opacity))) return false
  return true
}

/** A well-formed gradient: type + a non-empty array of valid stops. */
function isValidVectorGradient(v: unknown): v is VectorGradient {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.type !== 'linear' && o.type !== 'radial') return false
  if (!Array.isArray(o.stops) || o.stops.length === 0) return false
  return o.stops.every(isValidGradientStop)
}

/** A well-formed pattern rect: finite geometry, string fill. */
function isValidPatternRect(r: unknown): r is { x: number; y: number; width: number; height: number; fill: string } {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return typeof o.x === 'number' && Number.isFinite(o.x)
    && typeof o.y === 'number' && Number.isFinite(o.y)
    && typeof o.width === 'number' && Number.isFinite(o.width)
    && typeof o.height === 'number' && Number.isFinite(o.height)
    && typeof o.fill === 'string'
}

/** A well-formed pattern: type + finite tile size + a valid rects array. */
function isValidVectorPattern(v: unknown): v is VectorPattern {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.type !== 'pattern') return false
  if (typeof o.width !== 'number' || !Number.isFinite(o.width)) return false
  if (typeof o.height !== 'number' || !Number.isFinite(o.height)) return false
  if (!Array.isArray(o.rects)) return false
  return o.rects.every(isValidPatternRect)
}

/** Accepts a string, or a well-formed gradient/pattern object; else falls back to default. */
const paint = (v: unknown, d: VectorPaint): VectorPaint => {
  if (typeof v === 'string') return v
  if (isValidVectorGradient(v)) return v
  if (isValidVectorPattern(v)) return v
  return d
}

/** Deep-merge an untrusted parsed value over DEFAULT_CONFIG so partial/old/junk configs stay safe. */
export function mergeConfig(raw: unknown): GeoShapeConfig {
  const o = (raw ?? {}) as Record<string, any>
  const d = DEFAULT_CONFIG
  const lo = (o.locks ?? {}) as Record<string, any>
  const locks: Record<string, boolean> = {}
  if (lo && typeof lo === 'object') {
    for (const [k, v] of Object.entries(lo)) locks[k] = bool(v, false)
  }
  return {
    shape: oneOf(o.shape, SHAPES, d.shape),
    sides: clampNum(o.sides, d.sides, 3, 24),
    starInner: num(o.starInner, d.starInner),
    irregularSeed: num(o.irregularSeed, d.irregularSeed),
    size: num(o.size, d.size),
    count: clampNum(o.count, d.count, 1, 200),
    layout: oneOf(o.layout, LAYOUTS, d.layout),
    radius: num(o.radius, d.radius),
    spacing: num(o.spacing, d.spacing),
    angleStep: num(o.angleStep, d.angleStep),
    rotateBase: num(o.rotateBase, d.rotateBase),
    rotateStep: num(o.rotateStep, d.rotateStep),
    scaleStart: num(o.scaleStart, d.scaleStart),
    scaleEnd: num(o.scaleEnd, d.scaleEnd),
    skew: num(o.skew, d.skew),
    spin: num(o.spin, d.spin),
    fillMode: oneOf(o.fillMode, FILLMODES, d.fillMode),
    overlapMode: oneOf(o.overlapMode, OVERLAPMODES, d.overlapMode),
    roundCorners: num(o.roundCorners, d.roundCorners),
    roundRadius: num(o.roundRadius, d.roundRadius),
    symmetry: bool(o.symmetry, d.symmetry),
    symmetryAxis: oneOf(o.symmetryAxis, SYMMETRY_AXES, d.symmetryAxis),
    symmetrySpacing: num(o.symmetrySpacing, d.symmetrySpacing),
    clipMask: oneOf(o.clipMask, CLIP_MASKS, d.clipMask),
    clipMaskSize: num(o.clipMaskSize, d.clipMaskSize),
    invert: bool(o.invert, d.invert),
    padding: num(o.padding, d.padding),
    strokeWidth: num(o.strokeWidth, d.strokeWidth),
    seed: num(o.seed, d.seed),
    fill: paint(o.fill, d.fill),
    stroke: o.stroke === null ? null : (typeof o.stroke === 'string' ? o.stroke : d.stroke),
    overlapFill: paint(o.overlapFill, d.overlapFill),
    gridCols: clampNum(o.gridCols, d.gridCols, 1, 24),
    gridRows: clampNum(o.gridRows, d.gridRows, 1, 24),
    locks,
  }
}
