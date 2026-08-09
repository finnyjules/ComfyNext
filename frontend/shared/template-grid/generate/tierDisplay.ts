import type { ElementV2, TextStyleV2 } from '../types'

/** `TierTypePanel`'s "what's actually rendering" fallback values (round-2b
 *  FIX 9). Reads off the SELECTED element's already fully-resolved `.style`
 *  — `tierText` (`stagings.ts`) spreads a staging's own voice default first,
 *  then the tier's own `item.type` last (so the tier's override always
 *  wins) — rather than a raw tier-only override plus a generic hardcoded
 *  literal ('Inter', 400, 0, blank). A tier whose own `type` never set a
 *  field now shows the staging's REAL voice default (e.g. `lockup`'s
 *  Playfair Display, the theme's resolved ink/accent colour token) instead
 *  of a guess that has nothing to do with what's on screen. Falls back to
 *  the literal default only when nothing text is selected at all — a
 *  display-only derivation, no editing behaviour changes (`patch()` still
 *  writes the tier's own `type`, unaffected). */
export function resolveTierDisplayStyle(
  el: ElementV2 | null | undefined,
): { fontFamily: string; fontWeight: 400 | 700; letterSpacing: number; color: string } {
  const style: TextStyleV2 = (el && el.type === 'text' ? el.style : undefined) ?? {}
  return {
    fontFamily: style.fontFamily || 'Inter',
    fontWeight: style.fontWeight || 400,
    letterSpacing: style.letterSpacing ?? 0,
    color: style.color ?? '',
  }
}
