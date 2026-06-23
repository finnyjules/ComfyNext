import { defaultsFromControls, type ControlSpec, type Params } from '~/lib/spacetype/effect'
import { DITHER_PATTERNS, LATTICES, MODES, MOTIFS, PLACEMENTS, SEAM_METHODS, SHAPE_FAMILIES, STYLIZE_KINDS, TILE_FAMILIES } from '~/lib/texturefx/types'

// Texture controls extend the shared ControlSpec with an optional `when`
// predicate for contextual reveal (e.g. show procedural controls only in
// procedural mode). The predicate reads the live params object.
export type TextureControl = ControlSpec & { when?: (p: Params) => boolean }

// Positive checks — `mode` is always defined (textureDefaults sets it).
const isProcedural = (p: Params) => String(p.mode) === 'procedural'
const isTruchet = (p: Params) => String(p.mode) === 'truchet'
const isRaster = (p: Params) => String(p.mode) === 'raster'
const isShapes = (p: Params) => String(p.mode) === 'shapes'

export const TEXTURE_CONTROLS: TextureControl[] = [
  // Lattice controls — hidden in raster mode (raster is whole-tile, no lattice).
  { key: 'lattice', label: 'Lattice', kind: 'select', options: [...LATTICES], default: 'square', group: 'Lattice', when: (p) => !isRaster(p) },
  { key: 'cells', label: 'Cells', kind: 'slider', min: 2, max: 40, step: 2, default: 8, group: 'Lattice', when: (p) => !isRaster(p) },

  { key: 'mode', label: 'Content', kind: 'select', options: [...MODES], default: 'procedural', group: 'Cell' },
  { key: 'shapeFamily', label: 'Shape', kind: 'select', options: [...SHAPE_FAMILIES], default: 'octagon', group: 'Cell', when: isShapes },
  { key: 'pinwheel', label: 'Pinwheel', kind: 'select', options: ['off', 'on'], default: 'on', group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'pinwheel' },
  { key: 'hexOrient', label: 'Orientation', kind: 'select', options: ['pointy', 'flat'], default: 'pointy', group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'hex' },
  { key: 'fsWidth', label: 'Scale width', kind: 'slider', min: 0.4, max: 2.0, step: 0.05, default: 1.0, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'fishscale' },
  { key: 'fsRowSpacing', label: 'Row spacing', kind: 'slider', min: 0.2, max: 0.9, step: 0.02, default: 0.5, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'fishscale' },
  { key: 'fsRadius', label: 'Arc radius', kind: 'slider', min: 0.55, max: 1.0, step: 0.01, default: 0.78, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'fishscale' },
  { key: 'weaveWidth', label: 'Strand width', kind: 'slider', min: 0.14, max: 0.42, step: 0.01, default: 0.34, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'weave3d' },
  // Arms must reach ~1 lattice step to interlock with neighbours (shorter = isolated
  // hexagons that just butt together; longer = tripods that mesh, leaving hex recesses).
  { key: 'armLength', label: 'Arm length', kind: 'slider', min: 0.6, max: 1.15, step: 0.01, default: 1.0, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'tripods' },
  { key: 'armWidth', label: 'Arm width', kind: 'slider', min: 0.2, max: 0.42, step: 0.01, default: 0.34, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'tripods' },
  { key: 'bevel', label: 'Bevel', kind: 'slider', min: 0, max: 0.7, step: 0.01, default: 0.45, group: 'Cell', when: (p) => isShapes(p) && String(p.shapeFamily) === 'tripods' },

  // Procedural motif controls — shown only in procedural mode.
  { key: 'motif', label: 'Motif', kind: 'select', options: [...MOTIFS], default: 'checker', group: 'Content', when: isProcedural },
  // 'Motif size' only affects dots (radius) + stripes (width); checker/grid are
  // sized by 'Cells'. 'Line weight' is only used by the grid motif. Reveal each
  // only where it does something, so neither reads as a dead slider.
  { key: 'scale', label: 'Motif size', kind: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.7, group: 'Content', when: (p) => isProcedural(p) && (String(p.motif) === 'dots' || String(p.motif) === 'stripes') },
  { key: 'lineWeight', label: 'Line weight', kind: 'slider', min: 0.02, max: 0.5, step: 0.01, default: 0.12, group: 'Content', when: (p) => isProcedural(p) && String(p.motif) === 'grid' },
  { key: 'jitter', label: 'Color jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Content', when: isProcedural },

  // Truchet controls — shown only in truchet mode.
  { key: 'tileFamily', label: 'Tile family', kind: 'select', options: [...TILE_FAMILIES], default: 'arcs', group: 'Truchet', when: isTruchet },
  { key: 'placement', label: 'Placement', kind: 'select', options: [...PLACEMENTS], default: 'random', group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' },
  { key: 'rotBias', label: 'Rotation bias', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'random' },
  { key: 'coherence', label: 'Coherence', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'multiscale' && String(p.placement) === 'structured' },
  { key: 'subdivide', label: 'Subdivide', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) === 'multiscale' },
  // 'Line weight' sizes the arc/band stroke — used by arcs, weave, multiscale.
  // Hidden for diagonal (a solid two-tone split has no stroke to size).
  { key: 'truchetWeight', label: 'Line weight', kind: 'slider', min: 0.06, max: 0.5, step: 0.01, default: 0.18, group: 'Truchet', when: (p) => isTruchet(p) && String(p.tileFamily) !== 'diagonal' },

  // Stroke controls — outline the boundaries between regions in shapes mode.
  // 'uniform' = one stroke color on all edges; 'per-role' = each region's edge
  // takes its own stroke color (Stroke A/B/C → role 0/1/2).
  { key: 'shapeStroke', label: 'Stroke', kind: 'select', options: ['off', 'uniform', 'per-role'], default: 'off', group: 'Stroke', when: isShapes },
  { key: 'shapeStrokeWidth', label: 'Stroke width', kind: 'slider', min: 0.01, max: 0.4, step: 0.01, default: 0.08, group: 'Stroke', when: (p) => isShapes(p) && String(p.shapeStroke) !== 'off' },
  { key: 'shapeStrokeColor', label: 'Stroke color', kind: 'color', default: '#0e1116', group: 'Stroke', when: (p) => isShapes(p) && String(p.shapeStroke) === 'uniform' },
  { key: 'shapeStrokeA', label: 'Stroke A', kind: 'color', default: '#0e1116', group: 'Stroke', when: (p) => isShapes(p) && String(p.shapeStroke) === 'per-role' },
  { key: 'shapeStrokeB', label: 'Stroke B', kind: 'color', default: '#0e1116', group: 'Stroke', when: (p) => isShapes(p) && String(p.shapeStroke) === 'per-role' },
  { key: 'shapeStrokeC', label: 'Stroke C', kind: 'color', default: '#0e1116', group: 'Stroke', when: (p) => isShapes(p) && String(p.shapeStroke) === 'per-role' },

  { key: 'colorA', label: 'Color A', kind: 'color', default: '#e8eef5', group: 'Fills', when: () => false },
  { key: 'colorB', label: 'Color B', kind: 'color', default: '#7aa2f7', group: 'Fills', when: () => false },
  { key: 'background', label: 'Background', kind: 'color', default: '#0e1116', group: 'Fills', when: () => false },

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
