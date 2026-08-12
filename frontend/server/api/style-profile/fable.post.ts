/**
 * POST /api/style-profile/fable   (dev-only)
 *
 * Writes a house-style "taste profile" by showing Claude Fable 5 a style's own
 * training images and asking it, as an art director, to describe ONLY the shared
 * visual treatment. Used by the Style Publisher to upgrade profiles from the real
 * training set (the images the LoRA actually learned from), which reads far better
 * than the Qwen-on-one-sample path.
 *
 * Body: { images: string[] (1–8 base64 image data URLs, downscaled client-side),
 *         styleLabel?: string, apiKey?: string }
 * Returns: { profile: string }
 *
 * Fable notes (see claude-api skill): thinking is always on — the `thinking`
 * param must be OMITTED (an explicit disable 400s). Safety classifiers can return
 * stop_reason "refusal"; we surface that as a clear error. Must be allowlisted in
 * comfyui-proxy.ts.
 */
import { extractModelText } from '../../lib/modelText'
import { resolveAnthropicKey, optionalApiKey, MAX_IMAGE_CHARS } from '../../lib/agentRequest'

const IMG_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/

// Elicits a dense, reusable text-to-image STYLE prompt (medium → treatment →
// named palette → explicit negatives → bracketed variable slots → genre tags),
// not flowing gallery prose. The example anchors the format only.
const PROFILE_PROMPT = `You are an art director writing a reusable STYLE prompt for a text-to-image model. From the training images above, describe their shared look so it can be reproduced on ANY subject.

Write ONE dense block (about 60–100 words) of comma- and clause-chained phrases — an image-generation style prompt, NOT flowing gallery prose. Follow this structure:
- Open with the medium / rendering technique (e.g. "Flat vector pop illustration", "Editorial poster illustration, detailed pencil rendering").
- Describe the characteristic treatment: linework, forms, how the style renders its typical subject, texture, lighting, and composition.
- Name the palette with SPECIFIC colours (e.g. "hot pink, cobalt blue, marigold yellow at full saturation") — never vague terms like "warm" or "muted" alone.
- State the defining NEGATIVES explicitly (e.g. "no outlines, no gradients, no shading, no depth").
- For an element that clearly varies across the set (often the background colour), give bracketed alternatives, e.g. "[pink/yellow/chartreuse]".
- Close with a few tag-like descriptors of the overall genre/feel (e.g. "Contemporary editorial character illustration, screen-flat, maximalist").

Describe only the visual style and treatment — never a specific real person, brand, logo, or named scene. Output only the style block: no preamble, no quotes, no headings, no bullet points.

FORMAT EXAMPLE (match its structure, density, and specificity ONLY — do not reuse its wording, palette, or subject):
Flat vector pop illustration, bold rounded blob character with oversized hands and simple dot-eye face, no outlines, shapes defined by flat color only. Saturated candy palette: hot pink, cobalt blue, kelly green, marigold yellow, coral red at full saturation. Clothing filled with dense doodle patterns and confetti shapes. Solid flat [pink/yellow/chartreuse] background, no depth, no gradients, no texture, no shading. Playful everyday objects with cute faces floating around the figure. Contemporary editorial character illustration, screen-flat, maximalist.`

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody(event) as { images?: unknown, styleLabel?: unknown, apiKey?: unknown }
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))

  const images = Array.isArray(body?.images) ? body.images : []
  if (!images.length || images.length > 8) {
    throw createError({ statusCode: 400, statusMessage: '1–8 images required' })
  }

  const imageBlocks = images.map((raw, i) => {
    const d = typeof raw === 'string' ? raw : ''
    const m = IMG_DATA_URL_RE.exec(d)
    if (!m) throw createError({ statusCode: 400, statusMessage: `image ${i + 1} must be a base64 image data URL` })
    if (d.length > MAX_IMAGE_CHARS) throw createError({ statusCode: 400, statusMessage: `image ${i + 1} is too large` })
    // Normalise jpg → jpeg for Anthropic's media_type.
    const mediaType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } }
  })

  const label = typeof body?.styleLabel === 'string' && body.styleLabel.trim()
    ? `\n\nStyle name (context only, do not quote): ${body.styleLabel.trim()}`
    : ''

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-fable-5', // thinking is always on for Fable — do NOT send a `thinking` field
        max_tokens: 1024,
        output_config: { effort: 'medium' }, // balances quality vs. latency for a per-style interactive call
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: PROFILE_PROMPT + label }] }],
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

  return { profile: extractModelText(data).trim() }
})
