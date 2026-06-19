/**
 * Pure helpers for the font-suggestion composable. Kept Vue-free so the
 * key/error decision is unit-tested without the Nuxt runtime.
 */
export interface FontSuggestion { family: string; reason: string; category: string }

export const STANDARD_KEY_ERROR = 'No Anthropic API key set. Add your key in Settings → AI.'

export type SuggestRequest =
  | { ok: true; body: { apiKey: string; query: string } }
  | { ok: false; error?: string }

/** Decide whether/how to call /api/font-suggest. No key -> error; blank query -> silent no-op. */
export function buildSuggestRequest(apiKey: string | null | undefined, query: string): SuggestRequest {
  if (!apiKey || !apiKey.trim()) return { ok: false, error: STANDARD_KEY_ERROR }
  const q = (query ?? '').trim()
  if (!q) return { ok: false }
  return { ok: true, body: { apiKey, query: q } }
}
