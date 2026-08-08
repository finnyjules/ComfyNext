import type { Rng } from './rng'
import type { KnobSpec } from './knobs'

export interface SurfaceResult {
  background: { fill?: string; image?: string }
  /** Luminance of the field — text flips to stay legible. */
  contrast: 'light' | 'dark'
}

export interface Surface {
  id: string
  name: string
  kind: 'procedural' | 'image'
  needsImage?: boolean
  knobs: KnobSpec[]
  apply(input: { rng: Rng; knobs: Record<string, unknown>; image?: string }): SurfaceResult
}

/** Flat paper — the classic near-white Swiss field. */
const flat: Surface = {
  id: 'flat', name: 'Flat paper', kind: 'procedural', knobs: [{ id: 'shade', pick: ['#f4f3ef', '#ffffff', '#eceae4'] }],
  apply: ({ knobs }) => ({ background: { fill: String(knobs.shade ?? '#f4f3ef') }, contrast: 'light' }),
}

/** Holographic — soft iridescent gradient (the HUS AV GLAS look). */
const holographic: Surface = {
  id: 'holographic', name: 'Holographic', kind: 'procedural',
  knobs: [{ id: 'angle', pick: [110, 120, 135] }],
  apply: ({ knobs }) => ({
    background: { fill: `linear-gradient(${Number(knobs.angle ?? 120)}deg, #e9edf2 0%, #c7cdd6 45%, #bcd6ff 70%, #ffd2b0 100%)` },
    contrast: 'light',
  }),
}

/** Tint — a saturated brand-ish colour field; text goes light. */
const tint: Surface = {
  id: 'tint', name: 'Tint block', kind: 'procedural',
  knobs: [{ id: 'fill', pick: ['#e0492f', '#1a1a1a', '#2f6fe0'] }],
  apply: ({ knobs }) => {
    const fill = String(knobs.fill ?? '#e0492f')
    return { background: { fill }, contrast: 'dark' }
  },
}

/** Split field — a two-tone diagonal, dark over light. Text stays dark. */
const splitField: Surface = {
  id: 'split-field', name: 'Split field', kind: 'procedural',
  knobs: [{ id: 'angle', pick: [160, 200] }],
  apply: ({ knobs }) => ({
    background: { fill: `linear-gradient(${Number(knobs.angle ?? 160)}deg, #141414 0%, #141414 48%, #f4f3ef 48%, #f4f3ef 100%)` },
    contrast: 'light',
  }),
}

/** Duotone photo — a wired/picked image as the field; text goes light. */
const duotonePhoto: Surface = {
  id: 'duotone-photo', name: 'Duotone photo', kind: 'image', needsImage: true, knobs: [],
  apply: ({ image }) => ({ background: { image: image ?? '' }, contrast: 'dark' }),
}

export const SURFACES: Surface[] = [flat, holographic, tint, splitField, duotonePhoto]

export function getSurface(id: string): Surface | undefined {
  return SURFACES.find(s => s.id === id)
}
