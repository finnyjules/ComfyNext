// frontend/shared/brand/resolve.ts
import type { BrandKit } from './types'

/** Drop undefined/empty-string entries so partial kits inherit instead of clobbering. */
function compact(kit: BrandKit | undefined): Partial<BrandKit> {
  if (!kit) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(kit)) {
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Pass the result as the
 * `brand` scope of resolveTokens.
 */
export function effectiveBrand(
  templateDefaults?: BrandKit,
  activeKit?: BrandKit,
  wired?: BrandKit,
): BrandKit {
  return { ...compact(templateDefaults), ...compact(activeKit), ...compact(wired) }
}
