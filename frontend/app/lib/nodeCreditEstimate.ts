/**
 * Model-aware credit estimate for a node's cost badge (hosted mode).
 *
 * WHY THIS EXISTS: the badge Python ships on each node (`price_badge`) is a
 * single static USD figure. On the five model-PICKER classes that figure is a
 * fiction — GenerateVideoNode's badge quotes one price while its model widget
 * spans $0.04 (LTX) to $3.20 (Veo 3.1), an 8x divergence from what the server
 * will actually charge. A badge that reads "~7 cr" on a run that debits 480 is
 * worse than no badge, so for those five classes the badge prices from the
 * model the user has selected RIGHT NOW.
 *
 * PARITY: this mirrors `graphNodeModelCredits` in server/utils/priceBook.ts —
 * same catalogs (IMAGE_MODELS.pricePerImage / VIDEO_MODEL_USD / ENGINE_USD),
 * same legacy remap, same markup policy (creditsForUsd is a documented mirror
 * of creditsForUsdServer). It is still only an ESTIMATE: `priceGraph` at
 * submit time is authoritative, and it can't be fooled by this label because
 * it never reads it.
 *
 * FALLS BACK, NEVER THROWS: the server FAILS CLOSED on an unknown model (it
 * refuses the graph). A badge must not — an unpriceable model returns null and
 * the caller drops back to the static regex estimate.
 */
import { IMAGE_MODELS } from '~/data/image-models'
import { VIDEO_MODEL_USD, LEGACY_VIDEO_MODEL_IDS } from '~/data/video-prices'
import { ENGINE_USD } from '~/data/engine-prices'
import { creditsForUsd } from '~/lib/pricing'

/** Flat credits the graph pricer adds once for producing a deliverable. */
export const BASE_RENDER_CREDITS = 1

/**
 * The classes whose price depends on a `model` widget. Mirrors
 * MODEL_PRICED_NODE_CLASSES in server/utils/priceBook.ts — kept as a Set here
 * because the badge only ever asks "is this one of them?".
 */
export const MODEL_PRICED_BADGE_CLASSES: ReadonlySet<string> = new Set([
  'GenerateImageNode',
  'GenerateVideoNode',
  'FilmShotNode',
  'UpscaleImageNode',
  'EnhanceDetailNode',
])

// Lazily-built lookup. Never derive this at module top level: a top-level const
// reading another module's const breaks on import reorder.
let _imagePrices: Map<string, number | null> | null = null
function imagePriceFor(id: string): number | null | undefined {
  if (!_imagePrices) _imagePrices = new Map(IMAGE_MODELS.map(m => [m.id, m.pricePerImage]))
  return _imagePrices.get(id)
}

/**
 * Provider USD for `nodeType` at the currently-selected `model` widget value,
 * or null when the class isn't model-priced / the value is missing or unknown.
 */
export function modelPricedUsd(nodeType: string, model: unknown): number | null {
  if (!MODEL_PRICED_BADGE_CLASSES.has(nodeType)) return null
  const picked = typeof model === 'string' ? model.trim() : ''
  if (!picked) return null

  if (nodeType === 'GenerateImageNode') {
    const usd = imagePriceFor(picked)
    // undefined = not in the catalog; null = catalog says "varies / unknown".
    return typeof usd === 'number' ? usd : null
  }

  if (nodeType === 'GenerateVideoNode' || nodeType === 'FilmShotNode') {
    const id = LEGACY_VIDEO_MODEL_IDS[picked] ?? picked
    return VIDEO_MODEL_USD[id]?.usd ?? null
  }

  // Engine pickers (UpscaleImageNode / EnhanceDetailNode): the `model` widget
  // names an engine, not a catalog id.
  return ENGINE_USD[nodeType]?.[picked] ?? null
}

/**
 * Total credits the graph pricer would charge for this node as configured:
 * the model's USD through the markup policy, plus the one-off base render.
 * Null when the estimate can't be derived — the caller keeps its static badge.
 */
export function nodeCreditEstimate(nodeType: string, model: unknown): number | null {
  const usd = modelPricedUsd(nodeType, model)
  if (usd == null || !(usd > 0)) return null
  return creditsForUsd(usd) + BASE_RENDER_CREDITS
}
