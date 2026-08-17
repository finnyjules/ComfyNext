/**
 * Engine-picker per-engine USD prices — pure data, zero imports (same pattern
 * as app/data/image-models.ts). USD comes from the per-engine ranges in each
 * node's own description in nodes_replicate.py; ranges take the TOP so the
 * expensive setting is never underpriced.
 *
 * Consumed by BOTH server/utils/priceBook.ts (authoritative charging) and the
 * client-side cost badge — edits here propagate to both. Server code must not
 * import server/ from app/, so this table lives in app/data instead of
 * server/utils and priceBook.ts imports it back in.
 */
export const ENGINE_USD: Record<string, Record<string, number>> = {
  UpscaleImageNode: {
    'Clarity': 0.20,        // description: ~$0.05–0.20
    'Crystal': 0.04,        // description: ~$0.01–0.04
    'Real-ESRGAN': 0.002,   // description: ~$0.002
    'Recraft Crisp': 0.006, // description: ~$0.006
    'Topaz': 0.05,          // description: ~$0.05+
  },
  EnhanceDetailNode: {
    'Creative': 0.20,          // description: Clarity ~$0.05–0.20
    'Faithful': 0.05,          // description: Topaz ~$0.05
    'Diffusion Refine': 0.10,  // description: Magic Refiner ~$0.05–0.10
  },
}
