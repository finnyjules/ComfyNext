import { modelForTier } from '../lib/aiModels'
import { assertRateLimit } from '../lib/rateLimit'
import { optionalApiKey, resolveAnthropicKey } from '../lib/agentRequest'

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'explain')
  const body = await readBody(event)
  const { graphData, apiKey: clientKey } = body || {}
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(clientKey))

  if (!graphData || typeof graphData !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing graph data' })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelForTier('plan'),
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `You are a ComfyUI expert. Analyze this ComfyUI workflow graph data and explain what it does.

Here is the graph data (nodes and connections):

${graphData}

Describe:
1. What this workflow does overall (in 1-2 sentences)
2. The key nodes and their purpose
3. The data flow between nodes
4. What the final output will be
5. Any notable techniques or settings

Be concise and practical. Use markdown formatting.`,
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[explain] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const explanation = data?.content?.[0]?.text || 'No explanation generated.'
    return { explanation }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
