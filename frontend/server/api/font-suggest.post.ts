// Map a free-text description to real Google Fonts families.
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// Haiku + structured outputs. We ground the model's names against the real
// Google catalog (server/utils/fontMatch) so hallucinated families never ship.
import { getGoogleCatalog } from '../utils/googleCatalog'
import { groundSuggestions } from '../utils/fontMatch'

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    // The model reasons here FIRST (chain-of-thought) so its family picks match
    // the reference's actual letterforms instead of a generic vibe. Not shown to
    // the user.
    analysis: {
      type: 'string',
      description: 'The concrete typographic traits implied by the description: classification (sans/serif/slab/script/display), weight, width (condensed/extended), contrast, mood/era, and any specific reference letterforms.',
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          family: { type: 'string', description: 'Exact Google Fonts family name' },
          reason: { type: 'string', description: 'Max ~12 words tying the font to a SPECIFIC trait from the analysis' },
        },
        required: ['family', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis', 'suggestions'],
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

  const prompt = `You are a typographer matching a description to real Google Fonts families.

USER DESCRIPTION: "${description}"

Work in two steps:
1. ANALYSIS — Determine the concrete typographic traits the description implies. If it names a brand, logo, era, team, or genre (e.g. "New York Knicks logo", "1970s disco", "brutalist poster"), recall what those letterforms ACTUALLY look like — classification (sans / serif / slab serif / script / display), weight, width (condensed/normal/extended), stroke contrast, and mood. The Knicks wordmark, for example, is a bold, slightly slanted athletic/collegiate block serif — NOT a delicate fashion serif.
2. SUGGESTIONS — Pick up to 8 Google Fonts whose letterforms genuinely match those traits.

Rules:
- Match the FORM, not just the vibe. Do not default to generic "elegant serif" picks (Playfair Display, Cormorant) unless the analysis truly calls for a high-contrast fashion serif.
- Only real Google Fonts families, spelled exactly as Google Fonts spells them.
- Favor variety across the matching style; avoid near-duplicates.
- Each "reason" (≤12 words) must tie the font to a SPECIFIC trait from your analysis.`

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
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
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
