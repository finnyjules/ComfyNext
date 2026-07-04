// Natural-language → parameter patch for the Type Studio "vibe control".
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// no SDK. Haiku + structured outputs keep it fast and ~half a cent per ask.
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { VIBE_SCHEMA, buildVibePrompt } from '~/lib/vibePrompt'
import { MAX_PHRASE_CHARS, MAX_PROMPT_CHARS, optionalString, requireApiKey, requireString } from '../lib/agentRequest'

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'vibe', 60)
  const body = await readBody(event)
  const apiKey = requireApiKey(body?.apiKey)
  const phrase = requireString(body?.phrase, 'phrase', MAX_PHRASE_CHARS)
  const guidance = optionalString(body?.guidance, 'guidance', MAX_PROMPT_CHARS)
  const effectLabel = optionalString(body?.effectLabel, 'effectLabel', 200) ?? 'effect'
  const controls = body?.controls
  if (!Array.isArray(controls) || controls.length > 500) {
    throw createError({ statusCode: 400, message: 'controls (array, ≤500) is required' })
  }

  const prompt = buildVibePrompt(controls, phrase, effectLabel, guidance)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: VIBE_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      }),
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
      return { changes: parsed.changes ?? [], rationale: parsed.rationale ?? '' }
    }
    catch {
      throw createError({ statusCode: 502, message: 'Malformed response from Claude' })
    }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
