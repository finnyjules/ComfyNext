/**
 * GET /api/google-fonts
 *
 * Returns the full Google Fonts catalog as a slim list the Font Playground's
 * picker can search. Catalog fetch/cache lives in server/utils/googleCatalog.ts
 * (shared with /api/font-suggest). No API key required.
 *
 * Response: `{ fonts: GoogleFont[], count: number }`.
 */
import { getGoogleCatalog } from '../utils/googleCatalog'

export default defineEventHandler(async () => {
  const fonts = await getGoogleCatalog()
  return { fonts, count: fonts.length }
})
