export const LATTICES = ['square', 'brick', 'diagonal'] as const
export const MOTIFS = ['checker', 'stripes', 'dots', 'grid'] as const

export type Lattice = typeof LATTICES[number]
export type Motif = typeof MOTIFS[number]

// JSON clone — safe on Vue reactive proxies (structuredClone is not).
export function cloneParams<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export const MODES = ['procedural', 'truchet', 'raster', 'shapes'] as const
export const TILE_FAMILIES = ['arcs', 'diagonal', 'weave', 'multiscale'] as const
export const SEAM_METHODS = ['mirror', 'feather', 'direct'] as const
export const SHAPE_FAMILIES = ['octagon', 'pinwheel', 'chevron', 'basketweave', 'herringbone'] as const

export type Mode = typeof MODES[number]
export type SeamMethod = typeof SEAM_METHODS[number]
export type TileFamily = typeof TILE_FAMILIES[number]
export type ShapeFamily = typeof SHAPE_FAMILIES[number]

export const PLACEMENTS = ['random', 'structured'] as const
export type Placement = typeof PLACEMENTS[number]

export const STYLIZE_KINDS = ['none', 'dither', 'posterize', 'duotone'] as const
export type StylizeKind = typeof STYLIZE_KINDS[number]

// Curated, tileable dither patterns (label → bayer_dither u_pattern value).
export const DITHER_PATTERNS: Record<string, number> = {
  'Bayer 4×4': 1, 'Fine 8×8': 2, 'Coarse 2×2': 0, 'Clustered': 3,
  'Blue noise': 8, 'Blue noise 2×': 9, 'Blue noise ½×': 10,
}
// Pattern value → tiling period (cells-across must be a multiple of this for seamlessness).
export const DITHER_PERIOD: Record<number, number> = { 0: 2, 1: 4, 2: 8, 3: 8, 8: 64, 9: 128, 10: 32 }

export const STYLIZE_EFFECT_ID: Record<string, string> = {
  dither: 'bayer_dither', posterize: 'posterize', duotone: 'duotone',
}

export const FILL_TYPES = ['solid', 'gradient', 'image', 'pattern', 'link'] as const
export const FILL_FRAMES = ['cell', 'tile'] as const
export const GRADIENT_KINDS = ['linear', 'radial'] as const
export type FillType = typeof FILL_TYPES[number]
export type Frame = typeof FILL_FRAMES[number]
export type GradientStop = { c: string; p: number }
export type Fill =
  | { type: 'solid'; color: string; opacity?: number }
  | { type: 'gradient'; frame: Frame; kind: 'linear' | 'radial'; angle: number; stops: GradientStop[]; opacity?: number }
  | { type: 'image'; frame: Frame; src: string; seam: string; scale: number; opacity?: number }
  | { type: 'pattern'; frame: Frame; scale: number; sub: Record<string, unknown>; opacity?: number }
  | { type: 'link'; to: string }
export type FillsByRole = Record<string, Fill>
