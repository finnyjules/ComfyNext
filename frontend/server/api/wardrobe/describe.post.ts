/**
 * POST /api/wardrobe/describe
 *
 * Best-effort garment captioner for Character Studio: after a garment-mode
 * dress lands (useCharacterStudio.ts's keepDress), the client asks Fable to
 * describe ONLY the clothing in the dressed cover so the outfit reaches shot
 * prompts as text — auto-filling the look's `descriptor` when it's still
 * empty. Adapts server/api/taste/read.post.ts's transport exactly: raw
 * fetch, model claude-fable-5, no `thinking` field (thinking is always on;
 * an explicit disable 400s), BYOK client key wins.
 *
 * This route is best-effort by contract — the client silently skips on any
 * non-200 (missing key → 503, bad image → 400, upstream failure → 502/422),
 * never blocking the dress UX. See CharacterStudioModal.vue's keepNewLookDress.
 *
 * Body: { imageDataUrl: string, apiKey?: string }
 * Returns: { descriptor: string }  ('' when the model returned nothing usable)
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts ('/api/wardrobe').
 */
import { extractModelText } from '../../lib/modelText'
import { resolveAnthropicKey, optionalApiKey, MAX_IMAGE_CHARS } from '../../lib/agentRequest'
import { meterAssist } from '../../utils/anthropicMeter'
import { sanitizeCaption } from '~/lib/wardrobe/dress'

const IMG_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/

const DESCRIBE_PROMPT = 'Describe ONLY the clothing/outfit in this image as a comma-separated phrase under 12 words, e.g. "sleeveless navy tank, tailored black trousers". No name, no face/hair/body description, no full sentence. Return just the phrase, nothing else.'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { imageDataUrl?: unknown, apiKey?: unknown }
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))

  const raw = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : ''
  const m = IMG_DATA_URL_RE.exec(raw)
  if (!m) throw createError({ statusCode: 400, statusMessage: 'imageDataUrl must be a base64 image data URL' })
  if (raw.length > MAX_IMAGE_CHARS) throw createError({ statusCode: 400, statusMessage: 'image is too large' })
  // Normalise jpg → jpeg for Anthropic's media_type.
  const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]

  await meterAssist(event)

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-fable-5', // thinking is always on for Fable — do NOT send a `thinking` field
        max_tokens: 256,
        output_config: { effort: 'medium' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } },
            { type: 'text', text: DESCRIBE_PROMPT },
          ],
        }],
      }),
    })
  }
  catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: err?.message || 'Failed to reach Claude API' })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const msg = (() => { try { return JSON.parse(text)?.error?.message } catch { return '' } })()
    throw createError({ statusCode: res.status, statusMessage: msg || text.slice(0, 300) || 'Claude API error' })
  }

  const data = await res.json() as { stop_reason?: string, stop_details?: { explanation?: string } }
  if (data.stop_reason === 'refusal') {
    throw createError({ statusCode: 422, statusMessage: `Fable declined this request${data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : ''}` })
  }

  const text = extractModelText(data).trim()
  return { descriptor: sanitizeCaption(text) ?? '' }
})
