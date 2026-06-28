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
import { modelForTier } from '../lib/aiModels'

interface AgentPlanBody {
  apiKey?: string
  tier?: string
  prompt?: string
  schema?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AgentPlanBody>(event)
  const apiKey = body?.apiKey
  const prompt = body?.prompt
  const schema = body?.schema
  if (!apiKey || !prompt || !schema) {
    throw createError({ statusCode: 400, statusMessage: 'apiKey, prompt and schema are required' })
  }

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
      messages: [{ role: 'user', content: prompt }],
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
