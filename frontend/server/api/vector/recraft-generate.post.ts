/**
 * POST /api/vector/recraft-generate
 *
 * Text→SVG via Recraft (recraft-v3-svg on Replicate) — the only production model
 * that returns genuinely editable SVG. Body (JSON):
 *   { prompt: string, style?: string, size?: string }
 * Returns: { svg: string }  (fetched SVG markup, ready for svgToPathLayers)
 *
 * recraft-v3-svg styles: 'any' | 'engraving' | 'line_art' | 'line_circuit' |
 * 'linocut' (Replicate validates). 'any' is the general-purpose vector style.
 */
import { assertRateLimit } from '../../lib/rateLimit'

const MODEL = 'recraft-ai/recraft-v3-svg'
const VALID_STYLES = new Set(['any', 'engraving', 'line_art', 'line_circuit', 'linocut'])

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'recraft-generate', 30)
  const token = requireReplicateToken()
  const body = await readBody(event) as { prompt?: string; style?: string; size?: string }
  const prompt = (body.prompt || '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const style = body.style && VALID_STYLES.has(body.style) ? body.style : 'any'
  const input: Record<string, unknown> = {
    prompt,
    style,
    size: body.size || '1024x1024',
  }

  const output = await runReplicate(MODEL, input, token, { timeoutMs: 90_000 })
  const url = firstOutputUrl(output)
  if (!url) throw createError({ statusCode: 502, message: 'Recraft returned no SVG output' })

  // Recraft returns a URL to the .svg; fetch the markup so the client gets a
  // ready-to-import string (and we avoid CORS on the Replicate CDN).
  const svgRes = await fetch(url)
  if (!svgRes.ok) throw createError({ statusCode: 502, message: `Could not fetch generated SVG (${svgRes.status})` })
  const svg = await svgRes.text()
  return { svg, sourceUrl: url }
})
