export const LATTICES = ['square', 'brick', 'diagonal'] as const
export const MOTIFS = ['checker', 'stripes', 'dots', 'grid'] as const

export type Lattice = typeof LATTICES[number]
export type Motif = typeof MOTIFS[number]

// JSON clone — safe on Vue reactive proxies (structuredClone is not).
export function cloneParams<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export const MODES = ['procedural', 'truchet', 'raster'] as const
export const TILE_FAMILIES = ['arcs', 'diagonal', 'weave', 'multiscale'] as const
export const SEAM_METHODS = ['mirror', 'feather'] as const

export type Mode = typeof MODES[number]
export type SeamMethod = typeof SEAM_METHODS[number]
export type TileFamily = typeof TILE_FAMILIES[number]

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
