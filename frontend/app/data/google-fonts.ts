/**
 * Google Fonts catalog client — the type widgets' bridge to the full
 * ~1900-family library. The list is fetched once from our own /api/google-fonts
 * proxy (which strips Google's XSSI guard) and cached for the page session.
 *
 * Rendering a Google font needs only a CSS2 <link>; the catalog metadata adds
 * the axis ranges + weight options that drive the picker. Variable fonts expose
 * the registered axes (wght/wdth/slnt/opsz) as sliders — exotic custom axes are
 * left out of v1 to keep the request URL valid and the UI calm.
 *
 * Local render, no AI, no cost — same as the curated variable-font path.
 */
import type { FontAxis } from './variable-fonts'
import { setFontCatalog } from '~/lib/font/resolveFamily'

export interface GoogleFont {
  family: string
  category: string
  weights: number[]
  italic: boolean
  axes: { tag: string; min: number; max: number; default: number }[]
}

// Registered axes we surface as sliders (and request in the CSS2 URL). Listed
// alphabetically because the Google Fonts CSS2 API rejects unsorted tag tuples.
const SLIDER_AXES = ['opsz', 'slnt', 'wdth', 'wght'] as const
const AXIS_LABELS: Record<string, string> = {
  wght: 'Weight', wdth: 'Width', slnt: 'Slant', opsz: 'Optical size',
}

let catalog: GoogleFont[] | null = null
let inflight: Promise<GoogleFont[]> | null = null

/** Fetch (once) and cache the catalog. Resolves to [] on failure. */
export function loadGoogleCatalog(): Promise<GoogleFont[]> {
  if (catalog) return Promise.resolve(catalog)
  if (!inflight) {
    inflight = fetch('/api/google-fonts')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { fonts?: GoogleFont[] }) => {
        catalog = d.fonts ?? []
        // Keep the network-free resolver (~/lib/font/resolveFamily, used by
        // the Space Type render path) in sync with the same data, so
        // resolveFontFamily/fontHasWeightAxis see a real catalog too.
        setFontCatalog(catalog)
        return catalog
      })
      .catch(() => { inflight = null; return [] as GoogleFont[] })
  }
  return inflight
}

/** Registered axes of a font, as playground FontAxis sliders. */
export function googleAxisList(f: GoogleFont): FontAxis[] {
  return f.axes
    .filter(a => (SLIDER_AXES as readonly string[]).includes(a.tag))
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map(a => ({
      tag: a.tag,
      label: AXIS_LABELS[a.tag] ?? a.tag,
      min: a.min,
      max: a.max,
      default: a.default,
      step: a.max - a.min <= 2 ? 0.01 : 1,
    }))
}

/** CSS2 <link> href that serves the right file (full axis ranges, or all weights). */
export function buildGoogleCssUrl(f: GoogleFont): string {
  const fam = f.family.replace(/ /g, '+')
  const reg = f.axes
    .filter(a => (SLIDER_AXES as readonly string[]).includes(a.tag))
    .sort((a, b) => a.tag.localeCompare(b.tag))
  if (reg.length) {
    const tags = reg.map(a => a.tag).join(',')
    const ranges = reg.map(a => `${a.min}..${a.max}`).join(',')
    return `https://fonts.googleapis.com/css2?family=${fam}:${tags}@${ranges}&display=swap`
  }
  const ws = f.weights.join(';')
  return `https://fonts.googleapis.com/css2?family=${fam}:wght@${ws}&display=swap`
}

/** Minimal href for rendering a family at one weight (used before the catalog loads). */
export function quickGoogleCssUrl(family: string, weight: number): string {
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}&display=swap`
}

/** Weight in the font closest to `target`, for seeding the picker. */
export function nearestWeight(f: GoogleFont, target = 400): number {
  if (!f.weights.length) return 400
  return f.weights.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), f.weights[0]!)
}

// ── Space Type helpers ───────────────────────────────────────────────────────
// Synchronous accessors over the cached catalog (above). Space Type stores the
// font as a family NAME; effects resolve it during a synchronous buildScene, so
// these read whatever the catalog has loaded (the surface kicks off loadGoogleCatalog
// on mount). Before the catalog resolves they degrade gracefully.
//
// The actual implementations live in ~/lib/font/resolveFamily — a network-free
// module the Space Type render path (and the embed bundle it compiles into)
// imports directly, so it never drags in this file's `fetch` or
// ~/data/variable-fonts.ts's hardcoded fonts.googleapis.com URLs. Re-exported
// here so this module's other ~20 importers are unaffected.
export { resolveFontFamily, fontHasWeightAxis, setFontCatalog } from '~/lib/font/resolveFamily'

/** CSS2 <link> href for a family, using the catalog entry when available. */
export function googleFontCssUrl(family: string): string {
  const f = catalog?.find(g => g.family === family)
  return f ? buildGoogleCssUrl(f) : quickGoogleCssUrl(family, 400)
}
