// Copy assistant — variations / brief / translate ad-copy for Smart Layout
// text elements. Sibling of vibe.post.ts: raw fetch, user-supplied Anthropic
// key, no SDK, haiku + structured outputs.
import { buildCopyAssistPrompt, copyAssistSchema, clampCount } from '../lib/copyAssist'
import type { CopyAssistMode, CopyAssistRequest } from '../lib/copyAssist'

const MODES: CopyAssistMode[] = ['variations', 'brief', 'translate']

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, mode, text, brief, languages, count, context } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!mode || !MODES.includes(mode)) {
    throw createError({ statusCode: 400, message: `Invalid mode — expected one of ${MODES.join(', ')}` })
  }
  if ((mode === 'variations' || mode === 'translate') && (typeof text !== 'string' || !text.trim())) {
    throw createError({ statusCode: 400, message: 'Missing text' })
  }
  if (mode === 'brief' && (typeof brief !== 'string' || !brief.trim())) {
    throw createError({ statusCode: 400, message: 'Missing brief' })
  }
  if (mode === 'translate' && (!Array.isArray(languages) || languages.length === 0)) {
    throw createError({ statusCode: 400, message: 'Missing languages' })
  }

  const req: CopyAssistRequest = {
    apiKey,
    mode,
    text: typeof text === 'string' ? text : '',
    brief: typeof brief === 'string' ? brief : undefined,
    languages: Array.isArray(languages) ? languages : undefined,
    count: typeof count === 'number' ? count : undefined,
    context: context && typeof context === 'object' ? context : undefined,
  }

  const prompt = buildCopyAssistPrompt(req)
  const schema = copyAssistSchema(mode)
  clampCount(req) // validated for consistency; the prompt already embeds the count

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
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[copy-assist] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const responseText = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!responseText) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    try {
      const parsed = JSON.parse(responseText)
      return { options: Array.isArray(parsed.options) ? parsed.options : [] }
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
