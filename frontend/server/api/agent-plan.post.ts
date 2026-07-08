/**
 * Agent planning route (F1 wiring). A thin, stateless, NON-streaming proxy to the
 * model: the client builds the prompt + structured-output schema from a surface
 * snapshot (app/lib/agent/protocol.ts); this route calls the model at the
 * requested altitude tier with strict json_schema output and returns the raw JSON
 * text. The client parses it (parseAgentResponse) and applies it.
 *
 * Deliberately not streaming: SSE streaming proved fragile here (extended-thinking
 * hangs, sockets that never closed exhausting the browser pool). A single request
 * is reliable, and the model's `reasoning` field carries its thinking for display.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { modelForTier } from '../lib/aiModels'
import { MAX_PROMPT_CHARS, optionalApiKey, optionalTier, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { extractModelText } from '../lib/modelText'

interface AgentPlanBody {
  apiKey?: string
  tier?: string
  prompt?: string
  schema?: unknown
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'agent-plan')
  const body = await readBody<AgentPlanBody>(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const prompt = requireString(body?.prompt, 'prompt', MAX_PROMPT_CHARS)
  const tier = optionalTier(body?.tier)
  const schema = body?.schema
  if (!schema || typeof schema !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'schema (object) is required' })
  }

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
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: res.status, statusMessage: `model error: ${detail.slice(0, 200)}` })
  }

  const json = await res.json()
  return { text: extractModelText(json) }
})
