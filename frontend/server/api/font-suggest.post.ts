// Map a free-text description to real Google Fonts families.
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// Haiku + structured outputs. We ground the model's names against the real
// Google catalog (server/utils/fontMatch) so hallucinated families never ship.
import { getGoogleCatalog } from '../utils/googleCatalog'
import { groundSuggestions } from '../utils/fontMatch'

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          family: { type: 'string', description: 'Exact Google Fonts family name' },
          reason: { type: 'string', description: 'Max ~12 words on why it fits the description' },
        },
        required: ['family', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, query } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw createError({ statusCode: 400, message: 'Missing description' })
  }
  const description = query.trim().slice(0, 200)

  const prompt = `You recommend fonts. The user describes the look they want; suggest up to 8 real Google Fonts families that match.

USER DESCRIPTION: "${description}"

Rules:
- Only real Google Fonts families. Spell each exactly as Google Fonts spells it.
- Favor variety over near-duplicates of the same family.
- "reason" is at most ~12 words on why that font fits the description.`

  let suggestions: { family: string; reason: string }[]
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
        output_config: { format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[font-suggest] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!text) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    suggestions = JSON.parse(text).suggestions
  }
  catch (err: any) {
    if (err.statusCode) throw err
    if (err instanceof SyntaxError) throw createError({ statusCode: 502, message: 'Claude returned invalid JSON' })
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }

  const catalog = await getGoogleCatalog()
  return { suggestions: groundSuggestions(suggestions, catalog) }
})
