/**
 * Visual self-review route. The client renders the proposed layout to a PNG and
 * sends it here with a critique prompt + schema; this calls a multimodal model
 * that LOOKS at the image and returns { assessment, issues, fixes } (parsed by
 * parseReviewResponse). Non-streaming + strict json_schema for reliability —
 * the agent gets a designer's eye on the actual composition, not just the data.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { modelForTier } from '../lib/aiModels'
import { MAX_IMAGE_CHARS, MAX_PROMPT_CHARS, optionalApiKey, optionalString, optionalTier, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { extractModelText } from '../lib/modelText'

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
  assertRateLimit(event, 'agent-review')
  const body = await readBody<ReviewBody>(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const prompt = requireString(body?.prompt, 'prompt', MAX_PROMPT_CHARS)
  const image = requireString(body?.image, 'image', MAX_IMAGE_CHARS)
  const system = optionalString(body?.system, 'system', MAX_PROMPT_CHARS)
  const tier = optionalTier(body?.tier)
  const schema = body?.schema
  if (!schema || typeof schema !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'schema (object) is required' })
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
      model: modelForTier(tier),
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema } },
      // Cache the static instruction prefix: reviews cluster (iterate → render →
      // review, Variations bursts), so the 5-minute ephemeral window hits often.
      ...(system
        ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }
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

  const json = await res.json()
  return { text: extractModelText(json) }
})
