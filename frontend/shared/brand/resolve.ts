// frontend/shared/brand/resolve.ts
import type { BrandKit, BrandLogoSlots, BrandLogoSlotKey, BrandPaletteEntry, BrandColorKey } from './types'
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
    else if (k === 'palette' && Array.isArray(v) && v.length) out.palette = v
    else if (k === 'roles' && v && typeof v === 'object' && !Array.isArray(v)) {
      const roles: Record<string, string> = {}
      for (const [rk, rv] of Object.entries(v)) {
        if (typeof rv === 'string' && rv !== '') roles[rk] = rv
      }
      if (Object.keys(roles).length) out.roles = roles
    }
  }
  return out as Partial<BrandKit>
}

/** Token slug for a palette entry name: lowercase, non-alphanumerics → "_",
 *  collapsed and trimmed. "Deep Viridian" → "deep_viridian". */
export function paletteSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

const LEGACY_ROLE_NAMES: Record<BrandColorKey, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  accent2: 'Accent 2', foreground: 'Foreground', background: 'Background',
}

/** Derive a palette from a legacy kit's flat role fields. Empty when the kit
 *  already has a real palette (or no colors) — legacy kits need no migration;
 *  the editor persists this derivation on first palette edit. */
export function virtualPalette(kit: BrandKit | undefined): {
  entries: BrandPaletteEntry[]
  roles: Partial<Record<BrandColorKey, string>>
} {
  if (!kit || (kit.palette && kit.palette.length)) return { entries: [], roles: {} }
  const entries: BrandPaletteEntry[] = []
  const roles: Partial<Record<BrandColorKey, string>> = {}
  for (const key of BRAND_COLOR_KEYS) {
    const hex = kit[key]
    if (typeof hex === 'string' && hex !== '') {
      const id = `legacy-${key}`
      entries.push({ id, name: LEGACY_ROLE_NAMES[key], hex })
      roles[key] = id
    }
  }
  return { entries, roles }
}

/** One list for every swatch surface: named palette entries, falling back to
 *  the virtual (legacy-derived) palette. */
export function brandSwatches(kit: BrandKit | undefined): { name: string; hex: string }[] {
  if (!kit) return []
  const real = (kit.palette ?? []).filter(e => e.name !== '' && e.hex !== '')
  const entries = real.length ? real : virtualPalette(kit).entries
  return entries.map(e => ({ name: e.name, hex: e.hex }))
}

/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Logo slots merge per-slot;
 * `logo` back-fills from `logos.primary`. Palette: a later layer's non-empty
 * palette replaces the whole array; roles merge per-role and then materialize
 * the six role keys (fallback: merged legacy flat values). Flat
 * `palette.<slug>` keys are added so {{ brand.palette.<slug> }} resolves via
 * the resolver's flat-first lookup — same shape the backend's KV parse yields.
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

  const roles: Partial<Record<BrandColorKey, string>> = Object.assign({}, ...layers.map(l => l.roles ?? {}))
  const palette = out.palette ?? []           // last non-empty array won via compact+assign
  const byId = new Map(palette.map(e => [e.id, e]))

  // Materialize roles through the palette if there's an explicit palette; otherwise use legacy flat values
  if (palette.length) {
    for (const key of BRAND_COLOR_KEYS) {
      const entry = roles[key] != null ? byId.get(roles[key]!) : undefined
      if (entry) out[key] = entry.hex
      else if (roles[key] != null) delete out[key]  // dangling id in a real palette
    }
    if (Object.keys(roles).length) out.roles = roles
    // Add palette token keys for explicit palettes only
    for (const e of palette) {
      const slug = paletteSlug(e.name)
      if (slug && e.hex) (out as Record<string, unknown>)[`palette.${slug}`] = e.hex
    }
  } else {
    // For legacy kits (no explicit palette), use legacy flat values
    const virtPal = virtualPalette(out)
    const virtById = new Map(virtPal.entries.map(e => [e.id, e]))
    const allRoles = { ...virtPal.roles, ...roles }
    for (const key of BRAND_COLOR_KEYS) {
      const entry = allRoles[key] != null ? virtById.get(allRoles[key]!) : undefined
      if (entry) out[key] = entry.hex
    }
  }
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
  const entries = (kit.palette ?? []).filter(e => e.name !== '' && e.hex !== '')
  const byId = new Map(entries.map(e => [e.id, e]))
  const lines: string[] = []
  for (const k of KV_ORDER) {
    if (k === 'logo') {
      const logo = c.logos?.primary ?? (c.logo as string | undefined)
      if (logo != null) lines.push(`logo=${logo}`)
      continue
    }
    // Role keys materialize through the palette mapping; flat legacy wins are
    // already in `c[k]`, mapping overrides them.
    const mapped = kit.roles?.[k as BrandColorKey]
    const viaPalette = mapped != null ? byId.get(mapped)?.hex : undefined
    const v = viaPalette ?? c[k]
    if (v != null) lines.push(`${k}=${v}`)
  }
  for (const slot of BRAND_LOGO_SLOT_KEYS) {
    const v = c.logos?.[slot]
    if (v != null) lines.push(`logos.${slot}=${v}`)
  }
  for (const e of entries) {
    const slug = paletteSlug(e.name)
    if (slug) lines.push(`palette.${slug}=${e.hex}`)
  }
  return lines.join('\n')
}
