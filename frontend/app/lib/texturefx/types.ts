import type { Params } from '~/lib/spacetype/effect'

export type TextureParams = Params

export const LATTICES = ['square', 'brick', 'diagonal'] as const
export const MOTIFS = ['checker', 'stripes', 'dots', 'grid'] as const

export type Lattice = typeof LATTICES[number]
export type Motif = typeof MOTIFS[number]

// JSON clone — safe on Vue reactive proxies (structuredClone is not).
export function cloneParams<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
