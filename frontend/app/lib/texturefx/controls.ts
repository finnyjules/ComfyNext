import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { LATTICES, MOTIFS } from '~/lib/texturefx/types'

export const TEXTURE_CONTROLS: ControlSpec[] = [
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice' },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice' },
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content' },
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content' },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content' },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content' },
  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Color' },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Color' },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Color' },
]

// Numeric seed lives outside the control list (driven by the Roll button).
export function textureDefaults(): Params {
  return { ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }
}
