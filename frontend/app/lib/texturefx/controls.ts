import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { LATTICES, MODES, MOTIFS, PLACEMENTS, TILE_FAMILIES } from '~/lib/texturefx/types'

// Texture controls extend the shared ControlSpec with an optional `when`
// predicate for contextual reveal (e.g. show procedural controls only in
// procedural mode). The predicate reads the live params object.
export type TextureControl = ControlSpec & { when?: (p: Params) => boolean }

// Positive checks so adding a third mode (e.g. raster) later doesn't accidentally
// reveal procedural controls. `mode` is always defined (textureDefaults sets it).
const isProcedural = (p: Params) => String(p.mode) === 'procedural'
const isTruchet = (p: Params) => String(p.mode) === 'truchet'

export const TEXTURE_CONTROLS: TextureControl[] = [
  // Lattice, Cell (mode), and Color controls are always visible — no `when`.
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice' },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice' },

  { key: 'mode', label: 'Content', kind: 'select', options: [...MODES], default: 'procedural', group: 'Cell' },

  // Procedural motif controls — shown only in procedural mode.
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content', when: isProcedural },
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content', when: isProcedural },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content', when: isProcedural },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content', when: isProcedural },

  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'placement', label: 'Placement', kind: 'select', options: [...PLACEMENTS], default: 'random', group: 'Truchet', when: isTruchet },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.placement) === 'random' },
  { key: 'coherence', label: 'Coherence', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Truchet', when: (p) => isTruchet(p) && String(p.placement) === 'structured' },
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: isTruchet }, // same label as lineWeight; distinct key, only one mode visible at a time

  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Color' },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Color' },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Color' },
]

// Numeric seed lives outside the control list (driven by the Roll button).
export function textureDefaults(): Params {
  return { ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }
}
