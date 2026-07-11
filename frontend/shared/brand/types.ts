// frontend/shared/brand/types.ts
/**
 * Brand kit — the project-level brand roles every themed feature consumes
 * (Smart Layout templates, Kinetic Slates motion templates). Templates bind
 * via `{{ brand.<key> }}` tokens (shared/template-grid/tokens.ts); kits are
 * named entries in the app-wide library (server/brand-kits/*.json) and a
 * project picks its active kit via ProjectDoc.brandKitId.
 */

export interface BrandLogoSlots {
  primary?: string   // /view?filename=…&type=input or external URL
  mark?: string      // square mark / favicon-style
  wordmark?: string
  onDark?: string    // light-on-dark variant
}

export interface BrandAsset {
  id: string
  name: string
  path: string       // /view?… or external URL
}

export interface BrandPaletteEntry {
  id: string     // stable (e.g. crypto.randomUUID()); role refs survive renames
  name: string   // user-chosen, e.g. "Deep Viridian" — agents match on this
  hex: string    // #RRGGBB
}

export interface BrandKit {
  primary?: string
  secondary?: string
  accent?: string
  /** Second gradient stop — slate templates build accent→accent2 gradients
   *  from color roles so the kit itself stays flat JSON. */
  accent2?: string
  foreground?: string
  background?: string
  fontDisplay?: string
  fontBody?: string
  logo?: string        // legacy single logo; logos.primary wins when set
  logos?: BrandLogoSlots
  assets?: BrandAsset[]
  /** Named color palette — the editing model. Legacy flat role fields above
   *  remain readable; new kits stop writing them once a palette exists. */
  palette?: BrandPaletteEntry[]
  /** Role → palette entry id. Roles are how templates bind ({{ brand.primary }}). */
  roles?: Partial<Record<BrandColorKey, string>>
}

export const BRAND_COLOR_KEYS = ['primary', 'secondary', 'accent', 'accent2', 'foreground', 'background'] as const
export type BrandColorKey = typeof BRAND_COLOR_KEYS[number]

export const BRAND_LOGO_SLOT_KEYS = ['primary', 'mark', 'wordmark', 'onDark'] as const
export type BrandLogoSlotKey = typeof BRAND_LOGO_SLOT_KEYS[number]

export interface BrandKitEntry {
  id: string           // slug, [a-z0-9-]
  name: string         // user-facing, e.g. "LIV Golf 2025"
  kit: BrandKit
  updatedAt: string    // ISO timestamp
}
