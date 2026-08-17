/**
 * Per-clip USD for the video registry (app/data/video-models.ts), which prices
 * in a free-form `priceHint` string that money code must not parse. `hint` is
 * pinned to the catalog string by a parity test in price-graph.unit.spec.ts —
 * if the catalog's hint changes the test fails and the USD figure must be
 * re-derived by hand. Figures are the hint's quoted clip; ranges take the TOP
 * of the range so a long render is never underpriced.
 *
 * Pure data with zero imports (same pattern as app/data/engine-prices.ts).
 * Consumed by BOTH server/utils/priceBook.ts (authoritative charging) and the
 * hosted node cost badge in app/lib/nodeCreditEstimate.ts — the badge must
 * quote the same number the server will charge, so it reads THIS table rather
 * than a second hand-kept copy. Server code must not be imported from app/,
 * which is why the table lives here and priceBook.ts imports it back.
 */
export const VIDEO_MODEL_USD: Record<string, { usd: number; hint: string }> = {
  'veo-3.1': { usd: 3.20, hint: '~$3.20 / 8s · ~$1.60 silent' },
  'veo-3.1-fast': { usd: 1.20, hint: '~$1.20 / 8s · ~$0.80 silent' },
  'sora-2': { usd: 0.30, hint: '~$0.30 / 5s' },
  'sora-2-pro': { usd: 0.90, hint: '~$0.90 / 5s' },
  'flux-3': { usd: 2.00, hint: '~$0.20–0.40 / s' },
  'runway-gen-4.5': { usd: 0.80, hint: '~$0.80 / 5s' },
  'kling-v3': { usd: 0.60, hint: '~$0.60 / 10s' },
  'kling-v2.5-turbo-pro': { usd: 0.50, hint: '~$0.50 / 5s' },
  'seedance-2.0': { usd: 0.60, hint: '~$0.60 / 5s' },
  'seedance-2.0-fast': { usd: 0.30, hint: '~$0.30 / 5s' },
  'hailuo-2.3': { usd: 0.35, hint: '~$0.35 / 6s' },
  'wan-2.7-t2v': { usd: 0.15, hint: '~$0.15 / 5s' },
  'wan-2.5-i2v-fast': { usd: 0.06, hint: '~$0.06 / 5s' },
  'luma-ray-2-720p': { usd: 0.40, hint: '~$0.40 / 5s' },
  'ltx-video': { usd: 0.04, hint: '~$0.04 / 5s' },
  'pixverse-v6': { usd: 0.20, hint: '~$0.20 / 5s' },
  'fabric-1.0': { usd: 0.20, hint: '~$0.20 / 30s' },
}

/**
 * Legacy video-model labels GenerateVideoNode still remaps at execute time
 * (_LEGACY_MODEL_REMAP in comfy_api_nodes/nodes_replicate.py). Both the pricer
 * and the badge must price those saved graphs at the model that will actually
 * run — a saved node still holding 'Veo 3' costs veo-3.1 money.
 */
export const LEGACY_VIDEO_MODEL_IDS: Record<string, string> = {
  'Seedance 2.0': 'seedance-2.0',
  'Veo 3': 'veo-3.1',
  'Kling 2.1': 'kling-v2.5-turbo-pro',
}
