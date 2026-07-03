// Natural-language → parameter patch for the Type Studio "vibe control".
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// no SDK. Haiku + structured outputs keep it fast and ~half a cent per ask.
import { VIBE_SCHEMA, buildVibePrompt } from '~/lib/vibePrompt'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, controls, phrase, effectLabel, guidance } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!Array.isArray(controls) || !phrase || typeof phrase !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing controls or phrase' })
  }

  const prompt = buildVibePrompt(controls, phrase, typeof effectLabel === 'string' ? effectLabel : 'effect', typeof guidance === 'string' ? guidance : undefined)

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
