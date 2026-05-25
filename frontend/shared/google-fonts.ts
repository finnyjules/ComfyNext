/**
 * Helpers for resolving Google Fonts at runtime. Both halves (server render
 * + client editor preview) share the same URL shape, so the family name the
 * user typed produces consistent files on either side.
 */

/** Build the Google Fonts CSS URL for a family at the given weights. */
export function googleFontCssUrl(family: string, weights: number[] = [400, 700]): string {
  // Google's CSS API expects `+` for spaces, not `%20`.
  const f = encodeURIComponent(family.trim()).replace(/%20/g, '+')
  const w = weights.join(';')
  return `https://fonts.googleapis.com/css2?family=${f}:wght@${w}&display=swap`
}
