// frontend/shared/brand/resolve.ts
import type { BrandKit } from './types'
import { BRAND_COLOR_KEYS } from './types'

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

// Stable serialization order: colors first, then fonts, then logo.
const KV_ORDER: readonly string[] = [...BRAND_COLOR_KEYS, 'fontDisplay', 'fontBody', 'logo']

/**
 * Serialize a kit as `key=value` lines — the SmartLayout node's brand wire
 * format (parsed by splitting each line on the FIRST `=`, so values may
 * contain `=`, e.g. logo URLs). Empty kit ⇒ empty string, which submit-time
 * injection treats as "don't touch the widget" — workflows without an active
 * kit submit byte-identical values.
 */
export function brandKitToKv(kit: BrandKit): string {
  const c = compact(kit) as Record<string, string>
  return KV_ORDER.filter(k => c[k] != null).map(k => `${k}=${c[k]}`).join('\n')
}
