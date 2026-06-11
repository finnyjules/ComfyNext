// frontend/shared/brand/types.ts
/**
 * Brand kit — the project-level brand roles every themed feature consumes
 * (Smart Layout templates, Kinetic Slates motion templates). Templates bind
 * via `{{ brand.<key> }}` tokens (shared/template-grid/tokens.ts); kits are
 * named entries in the app-wide library (server/brand-kits/*.json) and a
 * project picks its active kit via ProjectDoc.brandKitId.
 */

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
  logo?: string        // URL or uploaded-file path
}

export const BRAND_COLOR_KEYS = ['primary', 'secondary', 'accent', 'accent2', 'foreground', 'background'] as const
export type BrandColorKey = typeof BRAND_COLOR_KEYS[number]

export interface BrandKitEntry {
  id: string           // slug, [a-z0-9-]
  name: string         // user-facing, e.g. "LIV Golf 2025"
  kit: BrandKit
  updatedAt: string    // ISO timestamp
}
