/**
 * What an SVG export of the whole APPEARANCE STACK will be.
 *
 * `lib/paint/toVector.ts`'s `exportTier(paint)` answers the question for ONE
 * paint, and it answers it by DERIVATION: it calls `paintToVectorPaint` — the
 * same function `vectorTypeSVG` calls to build the document — and classifies
 * what comes back. There is no list of kind names on either side, so a fill that
 * gains (or loses) a vector form moves tier on the day it changes.
 *
 * A stack turns that per-paint answer into a FOLD, and the fold is the honest
 * headline for the file: **one raster-tier layer makes the whole export raster**.
 * The file still carries every other layer as real geometry — the outlines are
 * always real paths — but a designer opening it in Illustrator finds a picture
 * where one of the layers used to be, and the product has to say which one
 * before the file is written, not after.
 *
 * Three properties this module is built to keep:
 *
 *  1. **The tier is still derived.** Every per-layer answer comes from
 *     `exportTier`. Nothing here knows that `shader` is raster and `stripes` is
 *     not; grep this file for a fill-type name and you will not find one.
 *  2. **Extrude is vector.** An extrude layer emits `depth` copies of the glyph
 *     outline — real paths — so its tier is simply its PAINT's tier, exactly as
 *     a fill's is. An extruded gradient stack therefore reports `vector`, and
 *     there is no `kind` branch below that could accidentally say otherwise.
 *  3. **Only layers that actually paint count.** A hidden shader layer costs the
 *     file nothing, so warning about it would be a false alarm — the kind that
 *     teaches users to ignore the note.
 *
 * ## The one duplication here, and what pins it
 *
 * `canvas.ts`'s `vtPaintLayers` decides which layers reach the document, and it
 * is NOT exported (Task 6 landed and verified that file; this task may not touch
 * it). `vtLayerInks` below therefore restates its drop rules — the one place in
 * this feature where two lists have to agree.
 *
 * It is restated rather than re-derived, and the mitigation is a test that reads
 * the REAL exported document: `tests/unit/vectortype-export-tier-stack` counts
 * the `<path>` elements `vectorTypeSVG` emits for each drop case and asserts the
 * layer contributed nothing. If `vtPaintLayers` ever starts keeping a layer this
 * drops (or dropping one this keeps), that test goes red rather than the note
 * going quietly wrong. **Hand-off:** exporting `vtPaintLayers`' predicate from
 * `canvas.ts` would remove the duplication outright and is the right fix the
 * next time that file is open.
 */
import { isFill } from '~/lib/compositor/paint'
import { hasPaint } from '~/lib/paint/resolve'
import { exportTier, type ExportTier } from '~/lib/paint/toVector'
// Value import, deliberately: `vtDrawLayers` is what turns a config of ANY
// vintage into the stack the renderer walks — including migrating a pre-stack
// blob on the spot. Re-deriving that here would be a second migration to keep in
// step with the first.
import { vtDrawLayers } from './canvas'
import type { VectorTypeConfig, VtAppearanceLayer, VtLayerKind } from './config'

/** Worst-first ordering. `raster` dominates, `pattern` beats `vector`. */
const TIER_RANK: Record<ExportTier, number> = { vector: 0, pattern: 1, raster: 2 }

export interface VtLayerExportTier {
  /** Position in the stack the export walks, 0 = back. */
  index: number
  /** What to call it. The stack UI's own derived name when the caller has one,
   *  else `Layer N` — see `vtExportTier`'s `labels` argument. */
  label: string
  kind: VtLayerKind
  /** The fill type's own name (`shader`, `ombre`, …) when the paint is a `Fill`,
   *  else `null` — a bare colour string and a `Gradient` have no type to say. */
  fillType: string | null
  tier: ExportTier
}

export interface VtStackExportTier {
  /** The whole document's tier: the worst tier any painting layer carries. */
  tier: ExportTier
  /** Every layer that will put ink in the file, in paint order. */
  layers: VtLayerExportTier[]
  /** The subset that forces `raster` — what the UI names. */
  raster: VtLayerExportTier[]
}

/**
 * Does this layer put ink in the exported document at all?
 *
 * Mirrors `vtPaintLayers`' drops, one for one. See the module header for why
 * this is a restatement and what stops it drifting.
 */
function vtLayerInks(layer: VtAppearanceLayer | null | undefined): boolean {
  if (!layer || typeof layer !== 'object') return false
  if (layer.enabled === false) return false
  // Anything unrecognised is dropped by the renderer rather than drawn as a
  // fill, so it exports nothing and cannot set the tier.
  if (layer.kind !== 'fill' && layer.kind !== 'stroke' && layer.kind !== 'extrude') return false
  if (!hasPaint(layer.paint)) return false
  // A non-finite opacity means "nobody said", which the renderer reads as 1 —
  // only a real number at or below zero drops the layer.
  if (Number.isFinite(layer.opacity) && layer.opacity <= 0) return false
  if (layer.kind === 'stroke' && !(Number.isFinite(layer.width) && layer.width > 0)) return false
  if (layer.kind === 'extrude' && !(Number.isFinite(layer.depth) && Math.round(layer.depth) > 0)) return false
  return true
}

/**
 * The export tier of a whole appearance stack.
 *
 * `labels` is the stack UI's own layer names, index-aligned with the config's
 * `appearance` array. Optional because this function is useful before the panel
 * exists (and headlessly); missing entries fall back to `Layer N`, which is
 * positional and therefore only ever a fallback — see `./layerLabel.ts`.
 */
export function vtExportTier(
  cfg: VectorTypeConfig | null | undefined,
  labels: string[] = [],
): VtStackExportTier {
  const layers: VtLayerExportTier[] = []
  vtDrawLayers(cfg).forEach((layer, index) => {
    if (!vtLayerInks(layer)) return
    layers.push({
      index,
      label: labels[index] ?? `Layer ${index + 1}`,
      kind: layer.kind,
      fillType: isFill(layer.paint) ? layer.paint.type : null,
      // THE derivation. `kind` is not consulted: an extrude's shapes are glyph
      // outlines like any other layer's, so what the file holds is decided by
      // the paint alone.
      tier: exportTier(layer.paint),
    })
  })
  // An empty stack exports an empty document, which is real (if boring) vector —
  // matching `vectorTypeSVG`, which writes no shapes for `appearance: []`.
  const tier = layers.reduce<ExportTier>(
    (worst, l) => (TIER_RANK[l.tier] > TIER_RANK[worst] ? l.tier : worst),
    'vector',
  )
  return { tier, layers, raster: layers.filter(l => l.tier === 'raster') }
}

/** "Layer 3 (shader)" — the layer named together with what makes it raster. */
function describeLayer(l: VtLayerExportTier): string {
  return l.fillType ? `${l.label} (${l.fillType})` : l.label
}

/**
 * One sentence naming the layers that force a raster export, or `null` when the
 * whole document is real vector.
 *
 * Naming the layer is the point. "This export contains a raster" is a warning a
 * user of a six-layer stack cannot act on; "Layer 3 (shader) exports as an
 * embedded image" is a instruction they can follow to the row and change.
 *
 * The tone matches the studio's other notes: it says what you GET, never what
 * you did wrong. For a great deal of work an embedded picture is the right
 * answer, and the callers all pair this with the half that is still vector.
 */
export function vtRasterNote(t: VtStackExportTier): string | null {
  const names = t.raster.map(describeLayer)
  if (!names.length) return null
  const verb = names.length === 1 ? 'exports as an embedded image' : 'export as embedded images'
  const list = names.length === 1
    ? (names[0] as string)
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${list} ${verb}`
}
