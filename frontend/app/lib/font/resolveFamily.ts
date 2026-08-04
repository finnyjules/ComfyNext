/**
 * Network-free font-family resolver — the render-path half of the Google
 * Fonts client (app/data/google-fonts.ts). Space Type effects statically
 * import this module and end up inside the embed bundle (see
 * app/lib/spacetype/effects/index.ts), which must never reach the network
 * (externalRefs() in app/lib/embed/bundle.ts throws on export otherwise).
 *
 * This module holds only synchronous reads of a module-level cache that the
 * app populates via setFontCatalog() — no fetch, no URL literals. That is the
 * whole point: do not import anything here that fetches, and do not add a URL
 * literal (including via a transitive import of app/data/variable-fonts.ts,
 * which carries live fonts.googleapis.com + SIL/OFL licence links).
 */

/** Minimal shape resolveFontFamily/fontHasWeightAxis need from a catalog
 *  entry. Deliberately narrower than data/google-fonts.ts's GoogleFont so
 *  this module never has a reason to import that (fetching) module. */
export interface GoogleFontLike {
  family: string
  weights: number[]
  axes: { tag: string }[]
}

/** Legacy VARIABLE_FONTS id → family name, extracted from
 *  app/data/variable-fonts.ts with the cssUrl/ttfPath stripped out — the id
 *  → family mapping is the only thing resolveFontFamily ever needed from
 *  that file. Keep in sync with VARIABLE_FONTS by hand; do not import that
 *  module to derive this, or the URLs come back with it. */
export const LEGACY_FONT_IDS: Record<string, string> = {
  'inter': 'Inter',
  'roboto-flex': 'Roboto Flex',
  'archivo': 'Archivo',
  'fraunces': 'Fraunces',
  'recursive': 'Recursive',
  'bricolage': 'Bricolage Grotesque',
  'big-shoulders': 'Big Shoulders Display',
  'space-grotesk': 'Space Grotesk',
  'unbounded': 'Unbounded',
  'source-serif': 'Source Serif 4',
}

let catalog: GoogleFontLike[] | null = null

/** Populate (or clear) the catalog cache. app/data/google-fonts.ts calls this
 *  every time it loads a fresh catalog (see its loadGoogleCatalog), so both
 *  modules read the same data without this module ever fetching itself. */
export function setFontCatalog(cat: GoogleFontLike[] | null): void {
  catalog = cat
}

/** Resolve a stored font value to a CSS family name. Accepts a family name
 *  directly, or a legacy VARIABLE_FONTS id (e.g. 'inter') saved by older
 *  Space Type nodes. */
export function resolveFontFamily(value: string): string {
  if (!value) return 'Inter'
  if (catalog?.some(f => f.family === value)) return value
  const legacy = LEGACY_FONT_IDS[value]
  if (legacy) return legacy
  return value // assume it's already a family name (catalog may not be loaded yet)
}

/** Whether a family has a continuous Weight axis (variable). Unknown ⇒ true
 *  so we don't wrongly hide the weight slider / clamp the weight before the
 *  catalog loads. */
export function fontHasWeightAxis(family: string): boolean {
  const f = catalog?.find(g => g.family === family)
  if (!f) return true
  return f.axes.some(a => a.tag === 'wght') || f.weights.length > 1
}
