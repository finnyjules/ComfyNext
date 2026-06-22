export const LATTICES = ['square', 'brick', 'diagonal'] as const
export const MOTIFS = ['checker', 'stripes', 'dots', 'grid'] as const

export type Lattice = typeof LATTICES[number]
export type Motif = typeof MOTIFS[number]

// JSON clone — safe on Vue reactive proxies (structuredClone is not).
export function cloneParams<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export const MODES = ['procedural', 'truchet'] as const
export const TILE_FAMILIES = ['arcs', 'diagonal', 'weave'] as const

export type Mode = typeof MODES[number]
export type TileFamily = typeof TILE_FAMILIES[number]
