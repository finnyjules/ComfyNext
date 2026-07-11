// frontend/shared/brand/resolve.ts
import type { BrandKit, BrandLogoSlots, BrandLogoSlotKey } from './types'
import { BRAND_COLOR_KEYS, BRAND_LOGO_SLOT_KEYS } from './types'

/** Drop undefined/empty-string entries so partial kits inherit instead of
 *  clobbering. `logos` is compacted per-slot; empty `assets` lists drop. */
function compact(kit: BrandKit | undefined): Partial<BrandKit> {
  if (!kit) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(kit)) {
    if (typeof v === 'string' && v !== '') out[k] = v
    else if (k === 'logos' && v && typeof v === 'object' && !Array.isArray(v)) {
      const slots: Record<string, string> = {}
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'string' && sv !== '') slots[sk] = sv
      }
      if (Object.keys(slots).length) out.logos = slots
    }
    else if (k === 'assets' && Array.isArray(v) && v.length) out.assets = v
  }
  return out as Partial<BrandKit>
}

/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Logo slots merge per-slot;
 * `logo` back-fills from `logos.primary` so `{{ brand.logo }}` keeps working.
 */
export function effectiveBrand(
  templateDefaults?: BrandKit,
  activeKit?: BrandKit,
  wired?: BrandKit,
): BrandKit {
  const layers = [compact(templateDefaults), compact(activeKit), compact(wired)]
  const out: BrandKit = Object.assign({}, ...layers)
  const logos: BrandLogoSlots = Object.assign({}, ...layers.map(l => l.logos ?? {}))
  if (Object.keys(logos).length) out.logos = logos
  else delete out.logos
  if (!out.logo && logos.primary) out.logo = logos.primary
  return out
}

/** Resolve a logo slot with legacy fallback: logos[slot], then (primary only)
 *  the legacy kit.logo string. */
export function brandLogoUrl(kit: BrandKit | undefined, slot: BrandLogoSlotKey = 'primary'): string | undefined {
  if (!kit) return undefined
  return kit.logos?.[slot] ?? (slot === 'primary' ? (kit.logo || undefined) : undefined)
}

// Stable serialization order: colors first, then fonts, then logo(s).
const KV_ORDER: readonly string[] = [...BRAND_COLOR_KEYS, 'fontDisplay', 'fontBody', 'logo']

/**
 * Serialize a kit as `key=value` lines — the SmartLayout node's brand wire
 * format (parsed by splitting each line on the FIRST `=`, so values may
 * contain `=`, e.g. logo URLs). The `logo=` line carries the effective primary
 * (logos.primary ?? logo); slots follow as `logos.<slot>=` dotted keys, which
 * the backend keeps as flat dict keys — resolveTokens looks those up flat-first.
 * `assets` are UI-side quick-picks, never template tokens: not serialized.
 * Empty kit ⇒ empty string, which submit-time injection treats as "don't touch
 * the widget" — workflows without an active kit submit byte-identical values.
 */
export function brandKitToKv(kit: BrandKit): string {
  const c = compact(kit) as Record<string, unknown> & { logos?: BrandLogoSlots }
  const lines: string[] = []
  for (const k of KV_ORDER) {
    if (k === 'logo') {
      const logo = c.logos?.primary ?? (c.logo as string | undefined)
      if (logo != null) lines.push(`logo=${logo}`)
      continue
    }
    if (c[k] != null) lines.push(`${k}=${c[k]}`)
  }
  for (const slot of BRAND_LOGO_SLOT_KEYS) {
    const v = c.logos?.[slot]
    if (v != null) lines.push(`logos.${slot}=${v}`)
  }
  return lines.join('\n')
}
