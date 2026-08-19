/**
 * Prompt-side moderation via OpenAI's free moderation endpoint. FAIL-OPEN by
 * design (design doc Component 1): on any error/timeout/non-200 the prompt is
 * ALLOWED and the failure is logged (Sentry-captured in Task 6) — a moderation
 * blip must not take all generation down for a watched beta. No OPENAI_API_KEY
 * (local mode) → no-op { ok: true }, byte-identical.
 */
import { captureError } from './observe'

let fetchOverride: typeof fetch | null = null
export function __setModerationFetchForTests(fn: typeof fetch | null): void { fetchOverride = fn }

const MODERATION_TIMEOUT_MS = 4000

export async function moderatePrompt(text: string): Promise<{ ok: true } | { ok: false, categories: string[] }> {
  const key = process.env.OPENAI_API_KEY
  if (!key || !text || !text.trim()) return { ok: true }
  const doFetch = fetchOverride ?? fetch
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), MODERATION_TIMEOUT_MS)
    let res: any
    try {
      res = await doFetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
        signal: ctrl.signal,
      })
    } finally { clearTimeout(t) }
    if (!res?.ok) { console.error('[moderation] non-200 — failing open', { status: res?.status }); captureError(new Error('moderation: non-200 — failing open'), { site: 'moderatePrompt', status: res?.status }); return { ok: true } }
    const data = await res.json()
    const result = data?.results?.[0]
    if (result?.flagged) {
      const categories = Object.entries(result.categories ?? {}).filter(([, v]) => v === true).map(([k]) => k)
      return { ok: false, categories }
    }
    return { ok: true }
  } catch (e) {
    console.error('[moderation] error — failing open', e)
    captureError(e, { site: 'moderatePrompt' })
    return { ok: true }
  }
}
