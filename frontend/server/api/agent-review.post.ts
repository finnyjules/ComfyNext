/**
 * Visual self-review route. The client renders the proposed layout to a PNG and
 * sends it here with a critique prompt + schema; this calls a multimodal model
 * that LOOKS at the image and returns { assessment, issues, fixes } (parsed by
 * parseReviewResponse). Non-streaming + strict json_schema for reliability —
 * the agent gets a designer's eye on the actual composition, not just the data.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { modelForTier } from '../lib/aiModels'

interface ReviewBody {
  apiKey?: string
  tier?: string
  /** STATIC instruction (byte-identical across calls) — sent as a cached system
   *  block so repeat reviews within the cache TTL read it at ~0.1× input price. */
  system?: string
  prompt?: string
  schema?: unknown
  image?: string // data URL (data:image/png;base64,…) or raw base64
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ReviewBody>(event)
  const { apiKey, prompt, schema, image } = body ?? {}
  if (!apiKey || !prompt || !schema || !image) {
    throw createError({ statusCode: 400, statusMessage: 'apiKey, prompt, schema and image are required' })
  }

  // Split a data URL into media type + base64 payload.
  const m = /^data:([^;]+);base64,(.*)$/s.exec(image)
  const mediaType = m?.[1] ?? 'image/png'
  const data = m?.[2] ?? image

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelForTier(body?.tier),
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema } },
      // Cache the static instruction prefix: reviews cluster (iterate → render →
      // review, Variations bursts), so the 5-minute ephemeral window hits often.
      ...(body?.system
        ? { system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }] }
        : {}),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, statusMessage: `model error: ${detail.slice(0, 200)}` })
  }

  const json = (await res.json()) as { content?: Array<{ text?: string }> }
  const text = json.content?.find(b => typeof b.text === 'string')?.text ?? ''
  return { text }
})
