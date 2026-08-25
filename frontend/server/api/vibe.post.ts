// Natural-language → parameter patch for the Type Studio "vibe control".
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// no SDK. Haiku + structured outputs keep it fast and ~half a cent per ask.
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { VIBE_SCHEMA, TAKES_SCHEMA, VARIANTS_UNSUPPORTED, buildVibePrompt, parseTakesResponse } from '~/lib/vibePrompt'
import { MAX_PHRASE_CHARS, MAX_PROMPT_CHARS, optionalApiKey, optionalString, optionalVariants, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { meterAssist } from '../utils/anthropicMeter'

/** Pure request-body builder, exported for a plain-Node unit test (no h3/fetch
 *  mocking needed) — pins the exact body Anthropic receives, both today's
 *  single-patch shape (variants absent — back-compat is the contract) and the
 *  variants branch (bigger schema, more tokens budget). Model is hardcoded
 *  here directly (not via modelForTier): this Haiku model has no thinking or
 *  latency-tier knob, and a unit test elsewhere pins that this file's request
 *  body never grows one by copy-paste. */
export function buildVibeRequestBody(prompt: string, variants?: number): Record<string, unknown> {
  return {
    model: 'claude-haiku-4-5',
    max_tokens: variants ? 2048 : 1024,
    output_config: { format: { type: 'json_schema', schema: variants ? TAKES_SCHEMA : VIBE_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  }
}

/** `optionalVariants`, but the rejection is TAGGED so a client can tell this
 *  route's own field validation from the 400 the Anthropic call below can also
 *  produce (whose status this route forwards verbatim). Still loud, still 2–4
 *  only — the contract Task 1 set is unchanged; only the error carries a name
 *  now. Exported for a plain-Node unit test, like `buildVibeRequestBody`. */
export function parseVariants(raw: unknown): number | undefined {
  try {
    return optionalVariants(raw)
  }
  catch (e: any) {
    throw createError({
      statusCode: 400,
      statusMessage: VARIANTS_UNSUPPORTED,
      message: e?.message || 'variants must be an integer between 2 and 4',
      data: { code: VARIANTS_UNSUPPORTED },
    })
  }
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'vibe', 60)
  const body = await readBody(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const phrase = requireString(body?.phrase, 'phrase', MAX_PHRASE_CHARS)
  const guidance = optionalString(body?.guidance, 'guidance', MAX_PROMPT_CHARS)
  const effectLabel = optionalString(body?.effectLabel, 'effectLabel', 200) ?? 'effect'
  const controls = body?.controls
  if (!Array.isArray(controls) || controls.length > 500) {
    throw createError({ statusCode: 400, message: 'controls (array, ≤500) is required' })
  }
  // Absent → today's single-patch call, byte-identical request and response.
  const variants = parseVariants(body?.variants)

  const prompt = buildVibePrompt(controls, phrase, effectLabel, guidance, variants)

  await meterAssist(event)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildVibeRequestBody(prompt, variants)),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[vibe] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!text) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    try {
      const parsed = JSON.parse(text)
      if (variants) {
        const takes = parseTakesResponse(parsed)
        if (!takes) throw createError({ statusCode: 502, message: 'Malformed response from Claude' })
        return { takes }
      }
      return { changes: parsed.changes ?? [], rationale: parsed.rationale ?? '' }
    }
    catch (e: any) {
      if (e?.statusCode) throw e
      throw createError({ statusCode: 502, message: 'Malformed response from Claude' })
    }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
