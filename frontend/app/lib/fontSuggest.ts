/**
 * Pure helpers for the font-suggestion composable. Kept Vue-free so the
 * key/error decision is unit-tested without the Nuxt runtime.
 */
export interface FontSuggestion { family: string; reason: string; category: string }

export type SuggestRequest =
  | { ok: true; body: { apiKey?: string; query: string } }
  | { ok: false; error?: string }

/** Decide how to call /api/font-suggest. Blank query -> silent no-op; a local
 *  key rides along as a BYOK override, otherwise the server key applies. */
export function buildSuggestRequest(apiKey: string | null | undefined, query: string): SuggestRequest {
  const q = (query ?? '').trim()
  if (!q) return { ok: false }
  const key = (apiKey ?? '').trim()
  return { ok: true, body: key ? { apiKey: key, query: q } : { query: q } }
}
