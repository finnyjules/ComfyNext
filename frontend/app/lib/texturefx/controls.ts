import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { DITHER_PATTERNS, LATTICES, MODES, MOTIFS, PLACEMENTS, SEAM_METHODS, STYLIZE_KINDS, TILE_FAMILIES } from '~/lib/texturefx/types'

// Texture controls extend the shared ControlSpec with an optional `when`
// predicate for contextual reveal (e.g. show procedural controls only in
// procedural mode). The predicate reads the live params object.
export type TextureControl = ControlSpec & { when?: (p: Params) => boolean }

// Positive checks — `mode` is always defined (textureDefaults sets it).
const isProcedural = (p: Params) => String(p.mode) === 'procedural'
const isTruchet = (p: Params) => String(p.mode) === 'truchet'
const isRaster = (p: Params) => String(p.mode) === 'raster'

export const TEXTURE_CONTROLS: TextureControl[] = [
  // Lattice controls — hidden in raster mode (raster is whole-tile, no lattice).
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice', when: (p) => !isRaster(p) },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice', when: (p) => !isRaster(p) },

  { key: 'mode', label: 'Content', kind: 'select', options: [...MODES], default: 'procedural', group: 'Cell' },

  // Procedural motif controls — shown only in procedural mode.
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content', when: isProcedural },
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content', when: isProcedural },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content', when: isProcedural },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content', when: isProcedural },

  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'placement', label: 'Placement', kind: 'select', options: [...PLACEMENTS], default: 'random', group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'random' },
  { key: 'coherence', label: 'Coherence', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'structured' },
  { key: 'subdivide', label: 'Subdivide', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) === 'multiscale' },
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: isTruchet }, // same label as lineWeight; distinct key, only one mode visible at a time

  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Color' },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Color' },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Color' },

  // Raster controls — rasterSrc is set by the surface's import button, not here.
  { key: 'seamMethod', label: 'Seamless method', kind: 'select', options: [...SEAM_METHODS], default: 'mirror', group: 'Raster', when: isRaster },
  { key: 'feather', label: 'Seam feather', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.15, group: 'Raster', when: (p) => isRaster(p) && String(p.seamMethod) === 'feather' },
  { key: 'rasterScale', label: 'Image scale', kind: 'slider', min: 0.25, max: 4, step: 0.05, default: 1, group: 'Raster', when: isRaster },

  { key: 'stylize', label: 'Stylize', kind: 'select', options: [...STYLIZE_KINDS], default: 'none', group: 'Stylize' },
  { key: 'ditherPattern', label: 'Dither pattern', kind: 'select', options: Object.keys(DITHER_PATTERNS), default: 'Bayer 4×4', group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherScale', label: 'Dither size', kind: 'slider', min: 0.004, max: 0.05, step: 0.001, default: 0.012, group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherLevels', label: 'Dither levels', kind: 'slider', min: 2, max: 8, step: 1, default: 3, group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'ditherColor', label: 'Dither color', kind: 'select', options: ['color', 'mono'], default: 'color', group: 'Stylize', when: (p) => String(p.stylize) === 'dither' },
  { key: 'posterizeLevels', label: 'Posterize levels', kind: 'slider', min: 2, max: 12, step: 1, default: 5, group: 'Stylize', when: (p) => String(p.stylize) === 'posterize' },
  { key: 'duoShadow', label: 'Shadow hue', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.62, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
  { key: 'duoLight', label: 'Light hue', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
  { key: 'duoContrast', label: 'Duotone contrast', kind: 'slider', min: 0, max: 2, step: 0.01, default: 0.5, group: 'Stylize', when: (p) => String(p.stylize) === 'duotone' },
]

// Numeric seed lives outside the control list (driven by the Roll button).
export function textureDefaults(): Params {
  return { ...defaultsFromControls(TEXTURE_CONTROLS), seed: 1 }
}
