/**
 * Ensures the browser has CSS @font-face rules for whatever fontFamily the
 * user picked in the template editor. The curated set is loaded eagerly via
 * @fontsource imports in EditorShell.vue; anything else is lazily fetched
 * from Google Fonts by injecting a single `<link>` tag per family.
 *
 * Safe to call multiple times for the same family — we de-dupe by name.
 */
import { googleFontCssUrl } from '~~/shared/google-fonts'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'
import type { EditState } from '~~/shared/timeline/types'

const CURATED = new Set(TEMPLATE_FONTS.map((f) => f.name))
const ensured = new Set<string>()  // module-scoped — survives component remounts

export function useGoogleFontPreview() {
  /** Make sure the browser will render `family` with the real face. */
  function ensure(family: string | null | undefined) {
    if (!family || typeof document === 'undefined') return
    const trimmed = family.trim()
    if (!trimmed || CURATED.has(trimmed) || ensured.has(trimmed)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = googleFontCssUrl(trimmed)
    link.dataset.googleFont = trimmed
    document.head.appendChild(link)
    // Optimistic second request for the full variable-weight range, so weight
    // controls beyond 400/700 render real faces. Variable families resolve it;
    // static families 400 the stylesheet, which fails silently — the 400/700
    // link above still applies and the browser snaps to the nearest weight.
    const range = document.createElement('link')
    range.rel = 'stylesheet'
    const f = encodeURIComponent(trimmed).replace(/%20/g, '+')
    range.href = `https://fonts.googleapis.com/css2?family=${f}:wght@100..900&display=swap`
    range.dataset.googleFont = `${trimmed}:range`
    document.head.appendChild(range)
    ensured.add(trimmed)
  }
  return { ensure }
}

/**
 * Best-effort: ensure the variable face for every Motion clip in the timeline
 * edit state is loaded so canvas text renders the real font (not a fallback).
 * Injects the Google CSS link (full axis range via useGoogleFontPreview) AND
 * asks the FontFaceSet to load a representative face so the first painted frame
 * has the real glyphs. Idempotent and silent on failure.
 */
export function ensureMotionFonts(state: EditState | null | undefined) {
  if (!state || typeof document === 'undefined') return
  const { ensure } = useGoogleFontPreview()
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== 'motion') continue
      const family = clip.layer?.fontFamily
      if (!family) continue
      ensure(family)
      // Force the variable face to actually download/parse so canvas draws it.
      document.fonts?.load(`700 32px "${family}"`).catch(() => {})
    }
  }
}
