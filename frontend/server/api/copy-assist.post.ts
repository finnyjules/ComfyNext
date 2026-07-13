// Copy assistant — variations / brief / translate ad-copy for Smart Layout
// text elements. Sibling of vibe.post.ts: raw fetch, user-supplied Anthropic
// key, no SDK, haiku + structured outputs.
import { buildCopyAssistPrompt, copyAssistSchema } from '../lib/copyAssist'
import { assertRateLimit } from '../lib/rateLimit'
import { MAX_PHRASE_CHARS, optionalApiKey, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import type { CopyAssistMode, CopyAssistRequest } from '../lib/copyAssist'

const MODES: CopyAssistMode[] = ['variations', 'brief', 'translate']

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'copy-assist', 60)
  const body = await readBody(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const mode = body?.mode
  if (!mode || !MODES.includes(mode)) {
    throw createError({ statusCode: 400, message: `Invalid mode — expected one of ${MODES.join(', ')}` })
  }

  let text: string | undefined
  let brief: string | undefined
  let languages: string[] | undefined
  let instruction: string | undefined

  if (mode === 'variations' || mode === 'translate') {
    text = requireString(body?.text, 'text', MAX_PHRASE_CHARS)
  }
  // Variations-only rewrite direction (Shorter / Punchier). Optional.
  if (mode === 'variations' && typeof body?.instruction === 'string' && body.instruction.trim()) {
    instruction = requireString(body.instruction, 'instruction', MAX_PHRASE_CHARS)
  }
  if (mode === 'brief') {
    brief = requireString(body?.brief, 'brief', MAX_PHRASE_CHARS)
  }
  if (mode === 'translate') {
    languages = body?.languages
    if (!Array.isArray(languages) || languages.length === 0) {
      throw createError({ statusCode: 400, message: 'languages (non-empty array) is required' })
    }
    if (languages.length > 50) {
      throw createError({ statusCode: 400, message: 'languages too long (max 50 entries)' })
    }
    languages = languages.map((lang: unknown) => requireString(lang, 'language', 100))
  }

  const req: CopyAssistRequest = {
    apiKey,
    mode,
    text: text || '',
    brief,
    languages,
    instruction,
    count: typeof body?.count === 'number' ? body.count : undefined,
    context: body?.context && typeof body.context === 'object' ? body.context : undefined,
  }

  const prompt = buildCopyAssistPrompt(req)
  const schema = copyAssistSchema(mode)

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
