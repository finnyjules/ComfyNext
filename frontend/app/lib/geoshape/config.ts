/**
 * geologo config — the 2D-vector clone-and-arrange logo generator's schema.
 *
 * Dependency-light on purpose (see the module import list below): this file
 * sits under Shape Studio's dynamic-import chain, same posture as
 * `shapefx/config.ts`, and must not drag in `three` or `paper`.
 */
import { BASE_SHAPES, type BaseShapeKind } from './shapes'
import type { Paint } from '~/lib/compositor/paint'

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
  /** radial only: spread clones evenly (360/count) instead of stepping by angleStep. */
  evenAngle: boolean
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
  fill: Paint
  stroke: string | null
  /** Used only when overlapMode === 'shape'. */
  overlapFill: Paint
  /** When true, `fills` is cycled across clones instead of the single `fill`. */
  perShapeFill: boolean
  /** Cycled fill list for perShapeFill mode. Always non-empty. */
  fills: Paint[]
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
  evenAngle: true,
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
  perShapeFill: false,
  fills: ['#1a1a2e', '#e5484d', '#f5a623'],
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

const SHAPES = BASE_SHAPES
const LAYOUTS = ['radial', 'grid', 'linear'] as const
const FILLMODES = ['evenodd', 'unite', 'subtract', 'intersect', 'exclude'] as const
const OVERLAPMODES = ['hole', 'shape'] as const
const SYMMETRY_AXES = ['vertical', 'horizontal'] as const
const CLIP_MASKS = ['none', 'circle', 'square', 'hexagon'] as const

/** Discriminants of every `Paint` arm: `Gradient` (linear/radial), `ImageFill` (image),
 *  and `Fill`'s `FillType` union (solid/gradient/ombre/grid/noise/checkerboard/stripes/qr/shader).
 *  Kept as a local literal set (not imported) so this file's import of `Paint` stays
 *  type-only — pulling `FILL_TYPES`/`FillType` as a value would drag `fillTile.ts` (and
 *  transitively `compositor/paint`'s `fillTile`/`imageFillCache` value imports) into
 *  config's import graph, which the Collection dynamic-import must avoid. */
const PAINT_TYPES = new Set(['linear', 'radial', 'image', 'solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr', 'shader'])

/** Accepts a string as-is, or an object whose `.type` is a known Paint discriminant
 *  (deep-copied so callers can't mutate DEFAULT_CONFIG); else `null`.
 *  Deliberately loose — the FillControl only ever emits valid Paints, this just rejects
 *  non-objects and unknown discriminants. */
function paintOrNull(v: unknown): Paint | null {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof (v as any).type === 'string' && PAINT_TYPES.has((v as any).type)) {
    return JSON.parse(JSON.stringify(v)) as Paint
  }
  return null
}

/** Single-fill validator: `paintOrNull`, falling back to `d` for junk. */
function paint(v: unknown, d: Paint): Paint {
  return paintOrNull(v) ?? d
}

/** Cycled fill-list validator: non-array → default; array with some valid entries →
 *  those entries only; array with no valid entries → default. Always returns non-empty,
 *  and deep-copies the default so callers can't mutate DEFAULT_CONFIG. */
function paintList(v: unknown, d: Paint[]): Paint[] {
  const copyD = () => d.map((p) => (typeof p === 'string' ? p : JSON.parse(JSON.stringify(p))))
  if (!Array.isArray(v)) return copyD()
  const out: Paint[] = []
  for (const e of v) {
    const p = paintOrNull(e)
    if (p !== null) out.push(p)
  }
  return out.length ? out : copyD()
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
    evenAngle: bool(o.evenAngle, d.evenAngle),
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
    perShapeFill: bool(o.perShapeFill, d.perShapeFill),
    fills: paintList(o.fills, d.fills),
    gridCols: clampNum(o.gridCols, d.gridCols, 1, 24),
    gridRows: clampNum(o.gridRows, d.gridRows, 1, 24),
    locks,
  }
}
