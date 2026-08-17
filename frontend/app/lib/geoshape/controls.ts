import type { ControlSpec } from '~/lib/spacetype/effect'
import {
  DEFAULT_CONFIG,
  type GeoShapeConfig,
  type GeoLayout,
  type GeoFillMode,
  type GeoOverlapMode,
  type GeoSymmetryAxis,
  type GeoClipMask,
} from './config'
import { BASE_SHAPES, type BaseShapeKind } from './shapes'
import type { Paint } from '~/lib/compositor/paint'

/**
 * The single declarative description of geologo's parameters.
 *
 * Mirrors `shapefx/controls.ts`'s posture: source for the agent's vocabulary
 * (`geoAgentControls`, in `agentControls.ts`) and for `StudioControlPanel`.
 * Keys are flat — every leaf on `GeoShapeConfig` is a top-level field, unlike
 * ShapeConfig's nested `shape.*`/`palette.*` — so control keys equal config
 * keys 1:1, pinned by the drift-guard test.
 *
 * Deliberately NOT here: `locks` (section-lock metadata, not a renderable
 * parameter).
 */
export type GeoControl = ControlSpec & { when?: (cfg: GeoShapeConfig) => boolean }

/** Emission order; a control whose group is not listed here is dropped. */
export const GEO_SECTIONS = ['Shape', 'Layout', 'Transform', 'Composite', 'Symmetry', 'Clip', 'Style', 'Paint'] as const

// Mirror of config.ts's own (private) enum lists — kept local rather than
// exported from config.ts because Task 7's commit stages only the new lib
// files, not a config.ts edit. Keep these in sync with config.ts's
// SHAPES/LAYOUTS/FILLMODES/OVERLAPMODES/SYMMETRY_AXES/CLIP_MASKS if that
// file's enums ever grow.
//
// Exported so randomize.ts (and any other geoshape module) shares this one
// copy instead of keeping its own verbatim duplicate.
export const SHAPES: BaseShapeKind[] = BASE_SHAPES
export const LAYOUTS: GeoLayout[] = ['radial', 'grid', 'linear']
export const FILLMODES: GeoFillMode[] = ['evenodd', 'unite', 'subtract', 'intersect', 'exclude']
export const OVERLAPMODES: GeoOverlapMode[] = ['hole', 'shape']
export const SYMMETRY_AXES: GeoSymmetryAxis[] = ['vertical', 'horizontal']
export const CLIP_MASKS: GeoClipMask[] = ['none', 'circle', 'square', 'hexagon']

// --- visibility gates, mirroring shapefx/controls.ts's isPrimitive/isGem/etc. ---
// `sides` drives polygon/star/irregular (baseShapePath's o.sides); hexagon is a
// fixed 6-gon and ignores it (see shapes.ts).
const usesSides = (c: GeoShapeConfig) => c.shape === 'star' || c.shape === 'irregular'
const isStar = (c: GeoShapeConfig) => c.shape === 'star'
const isIrregular = (c: GeoShapeConfig) => c.shape === 'irregular'
const hasRoundCorners = (c: GeoShapeConfig) => c.roundCorners > 0
const isGrid = (c: GeoShapeConfig) => c.layout === 'grid'
const isRadial = (c: GeoShapeConfig) => c.layout === 'radial'
const isGridOrLinear = (c: GeoShapeConfig) => c.layout === 'grid' || c.layout === 'linear'
const isOverlapShape = (c: GeoShapeConfig) => c.overlapMode === 'shape'
const isSingleFill = (c: GeoShapeConfig) => c.fillStrategy === 'single'
const isOverlapShapeAndSingleFill = (c: GeoShapeConfig) => isOverlapShape(c) && isSingleFill(c)
const hasSymmetry = (c: GeoShapeConfig) => c.symmetry === true
const hasClipMask = (c: GeoShapeConfig) => c.clipMask !== 'none'

/** A `Paint` reduced to a `color`-control default: solids pass through,
 *  gradients/patterns/images fall back to a plain swatch — the schema's `fill`/
 *  `overlapFill` controls stay declared as `kind: 'color'` (drift-guard + agent
 *  vocabulary need them there) even though the surface renders them bespoke via
 *  FillControl, which can hold the full `Paint`. */
const paintDefault = (p: Paint): string => (typeof p === 'string' ? p : '#111111')

const slider = (
  key: string, label: string, min: number, max: number, step: number, group: string,
  def: number, hint?: string, extra: Partial<GeoControl> = {},
): GeoControl =>
  ({ key, label, kind: 'slider', min, max, step, default: def, group, ...(hint ? { hint } : {}), ...extra } as GeoControl)

const select = (
  key: string, label: string, options: string[], def: string, group: string,
  hint?: string, extra: Partial<GeoControl> = {},
): GeoControl =>
  ({ key, label, kind: 'select', options, default: def, group, ...(hint ? { hint } : {}), ...extra } as GeoControl)

const color = (key: string, label: string, def: string, group: string, extra: Partial<GeoControl> = {}): GeoControl =>
  ({ key, label, kind: 'color', default: def, group, ...extra } as GeoControl)

const switchC = (key: string, label: string, def: boolean, group: string, extra: Partial<GeoControl> = {}): GeoControl =>
  ({ key, label, kind: 'switch', default: def, group, ...extra } as GeoControl)

export const GEO_CONTROLS: GeoControl[] = [
  // --- Shape (baseShapePath's BaseShapeOpts) --------------------------------
  select('shape', 'Shape', SHAPES, DEFAULT_CONFIG.shape, 'Shape',
    'polygon/star/irregular use Sides; hexagon is a fixed 6-gon'),
  slider('sides', 'Sides', 3, 24, 1, 'Shape', DEFAULT_CONFIG.sides, undefined, { when: usesSides }),
  // DEFAULT_CONFIG.starInner is 0.45, already inside starVertices' own
  // [0.01, 0.99] clamp (polygonGeometry.ts), so this control's default sits
  // inside its own declared range without needing help.
  slider('starInner', 'Star inner', 0.01, 0.99, 0.01, 'Shape', DEFAULT_CONFIG.starInner, undefined, { when: isStar }),
  slider('irregularSeed', 'Irregular seed', 1, 9999, 1, 'Shape', DEFAULT_CONFIG.irregularSeed, undefined, { when: isIrregular }),
  slider('size', 'Size', 20, 600, 1, 'Shape', DEFAULT_CONFIG.size),
  slider('roundCorners', 'Round corners', 0, 100, 1, 'Shape', DEFAULT_CONFIG.roundCorners,
    '0 = sharp corners; above 0 rounds by Round radius'),
  slider('roundRadius', 'Round radius', 0, 100, 1, 'Shape', DEFAULT_CONFIG.roundRadius, undefined, { when: hasRoundCorners }),

  // --- Layout (arrange.ts) --------------------------------------------------
  select('layout', 'Layout', LAYOUTS, DEFAULT_CONFIG.layout, 'Layout'),
  slider('count', 'Count', 1, 200, 1, 'Layout', DEFAULT_CONFIG.count, undefined, { when: (c) => !isGrid(c) }),
  slider('gridCols', 'Grid columns', 1, 24, 1, 'Layout', DEFAULT_CONFIG.gridCols, undefined, { when: isGrid }),
  slider('gridRows', 'Grid rows', 1, 24, 1, 'Layout', DEFAULT_CONFIG.gridRows, undefined, { when: isGrid }),
  slider('radius', 'Radius', 0, 800, 1, 'Layout', DEFAULT_CONFIG.radius, undefined, { when: isRadial }),
  slider('spacing', 'Spacing', 0, 800, 1, 'Layout', DEFAULT_CONFIG.spacing, undefined, { when: isGridOrLinear }),
  switchC('evenAngle', 'Even spacing', DEFAULT_CONFIG.evenAngle, 'Layout', { when: isRadial }),
  slider('angleStep', 'Angle step', 0, 360, 1, 'Layout', DEFAULT_CONFIG.angleStep, undefined, { when: (c) => isRadial(c) && !c.evenAngle }),

  // --- Transform (per-clone ramps in arrange.ts) ----------------------------
  slider('rotateBase', 'Rotate base', -180, 180, 1, 'Transform', DEFAULT_CONFIG.rotateBase),
  slider('rotateStep', 'Rotate step', -180, 180, 1, 'Transform', DEFAULT_CONFIG.rotateStep),
  slider('scaleStart', 'Scale start', 0.1, 3, 0.05, 'Transform', DEFAULT_CONFIG.scaleStart),
  slider('scaleEnd', 'Scale end', 0.1, 3, 0.05, 'Transform', DEFAULT_CONFIG.scaleEnd),
  slider('skew', 'Skew', -60, 60, 1, 'Transform', DEFAULT_CONFIG.skew),
  slider('spin', 'Spin', 0, 360, 1, 'Transform', DEFAULT_CONFIG.spin, undefined, { when: isRadial }),

  // --- Composite (boolean.ts's fold + overlap resolution) -------------------
  select('fillMode', 'Fill mode', FILLMODES, DEFAULT_CONFIG.fillMode, 'Composite',
    'How the clones fold together: evenodd cuts holes where they cross, unite/subtract/intersect/exclude are true boolean ops'),
  select('overlapMode', 'Overlap mode', OVERLAPMODES, DEFAULT_CONFIG.overlapMode, 'Composite',
    'hole = crossings read as a cut-through; shape = crossings paint as their own region in Overlap fill'),
  color('overlapFill', 'Overlap fill', paintDefault(DEFAULT_CONFIG.overlapFill), 'Composite', { when: isOverlapShapeAndSingleFill }),

  // --- Symmetry --------------------------------------------------------------
  switchC('symmetry', 'Symmetry', DEFAULT_CONFIG.symmetry, 'Symmetry'),
  select('symmetryAxis', 'Symmetry axis', SYMMETRY_AXES, DEFAULT_CONFIG.symmetryAxis, 'Symmetry', undefined, { when: hasSymmetry }),
  slider('symmetrySpacing', 'Symmetry spacing', 0, 400, 1, 'Symmetry', DEFAULT_CONFIG.symmetrySpacing, undefined, { when: hasSymmetry }),

  // --- Clip --------------------------------------------------------------------
  select('clipMask', 'Clip mask', CLIP_MASKS, DEFAULT_CONFIG.clipMask, 'Clip'),
  slider('clipMaskSize', 'Clip mask size', 10, 200, 1, 'Clip', DEFAULT_CONFIG.clipMaskSize, undefined, { when: hasClipMask }),
  switchC('invert', 'Invert', DEFAULT_CONFIG.invert, 'Clip'),

  // --- Style -------------------------------------------------------------------
  slider('padding', 'Padding', 0, 200, 1, 'Style', DEFAULT_CONFIG.padding),
  slider('strokeWidth', 'Stroke width', 0, 60, 1, 'Style', DEFAULT_CONFIG.strokeWidth),
  slider('seed', 'Seed', 1, 999999, 1, 'Style', DEFAULT_CONFIG.seed,
    'The random seed behind Re-roll; use Re-roll to generate variations.'),

  // --- Paint ---------------------------------------------------------------
  // `fills` and `overlapFills` (the cycled-list counterparts of `fill` and
  // `overlapFill`) have no control of their own — they're edited by bespoke
  // list editors (ShapeStudioSurface's fills-list block), not a single-value
  // row — so they're excluded from the drift guard's expected-key set
  // alongside `locks` (see that test's NON_CONTROL_FIELDS).
  select('fillStrategy', 'Fill', ['single', 'perClone', 'pieces'], DEFAULT_CONFIG.fillStrategy, 'Paint',
    'single = unified holes; perClone = one colour per shape; pieces = colour solo + overlap regions'),
  color('fill', 'Fill', paintDefault(DEFAULT_CONFIG.fill), 'Paint', { when: isSingleFill }),
  color('stroke', 'Stroke', DEFAULT_CONFIG.stroke ?? '#000000', 'Paint'),
]

/** Controls applicable to this config, in GEO_SECTIONS order. */
export function visibleGeoControls(cfg: GeoShapeConfig): GeoControl[] {
  const out: GeoControl[] = []
  for (const section of GEO_SECTIONS) {
    for (const c of GEO_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(cfg)) continue
      out.push(c)
    }
  }
  return out
}

/**
 * Domain guidance for the in-product agent (consumed by `geoAgentControls` /
 * `studioTune` wiring). Teaches the model how geologo's knobs combine — a
 * single base shape, cloned and arranged, then boolean-folded into one mark.
 */
export const GEO_GUIDANCE = `This is a PROCEDURAL 2D-VECTOR "clone and arrange" LOGO generator — one base shape, repeated and folded into a single flat mark, not a raster illustration.

BASE SHAPE: "shape" picks the family — polygon (regular N-gon via sides), star (N points via sides + starInner, the inner-vertex radius as a fraction of the outer radius, 0.01=needle-thin points, 0.99=almost a polygon), hexagon (fixed 6-gon, ignores sides), irregular (a polygon jittered per-vertex by irregularSeed — same seed always gives the same silhouette). size is the shape's radius before any clone spread. roundCorners (0=off) gates roundRadius, the corner-rounding fraction.

LAYOUT: count is how many clones to place (grid layout instead uses gridCols × gridRows and ignores count). layout picks the placement curve: "radial" rings the clones around the center at radius; by default (evenAngle) they spread evenly (360/count) so any count forms a clean ring, and turning evenAngle off spaces them by angleStep degrees instead (for fans/spirals). spin is the ring's starting angle offset. "grid" tiles gridCols × gridRows clones spacing apart. "linear" strings count clones in a row, spacing apart.

TRANSFORM: rotateBase + i*rotateStep rotates each successive clone (a spiral/fan feel as rotateStep grows). scaleStart→scaleEnd ramps clone size across the sequence (shrink/grow trails). skew shears every clone; spin only matters for radial layout.

COMPOSITE: fillMode is the boolean fold across all clones (evenodd = classic cut-hole overlap; unite/subtract/intersect/exclude are true boolean ops). overlapMode governs crossings specifically — "hole" cuts through, "shape" paints the crossing itself in overlapFill (a spot-color trick: use it to highlight where clones intersect).

SYMMETRY mirrors the whole composed mark across symmetryAxis (vertical/horizontal), offset by symmetrySpacing. CLIP crops the finished mark to clipMask (circle/square/hexagon) sized by clipMaskSize; invert swaps the mark's fill/ground so the shape reads as negative space.

STYLE: padding is the margin the SVG export keeps around the mark; strokeWidth is the outline width wherever stroke is set. seed drives irregularSeed-style jitter and re-roll — same seed, same mark.

PAINT: fill colors the mark, stroke outlines it (leave stroke unset for a fill-only flat mark, the common logo case), overlapFill only matters when overlapMode is "shape".`
