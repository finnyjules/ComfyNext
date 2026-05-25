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
    ensured.add(trimmed)
  }
  return { ensure }
}
