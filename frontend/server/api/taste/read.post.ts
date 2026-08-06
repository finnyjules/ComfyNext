/**
 * POST /api/taste/read   (dev-only)
 *
 * The elicited route of the executable-brand-kit spike: inspiration images →
 * Claude Fable 5 vision → the 12 taste facets as NUMBERS (shared/taste/facets.ts),
 * plus avoids (negative priors) and cluster-before-averaging (2+ registers on
 * the board → per-cluster readings instead of a mushy mean).
 *
 * Adapts server/api/style-profile/fable.post.ts's transport exactly: raw fetch,
 * model claude-fable-5 with NO `thinking` field (thinking is always on; an
 * explicit disable 400s), stop_reason 'refusal' → 422, BYOK client key wins.
 *
 * Body: { images: string[] (1–8 base64 image data URLs, downscaled client-side),
 *         apiKey?: string }
 * Returns: { reading: TasteReading }
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts ('/api/taste').
 */
import { extractModelText } from '../../lib/modelText'
import { resolveAnthropicKey, optionalApiKey, MAX_IMAGE_CHARS } from '../../lib/agentRequest'
import { TASTE_FACETS, FACET_IDS, facetReading, type FacetId, type TasteReading } from '../../../shared/taste/facets'

const IMG_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/

const FACET_LIST = TASTE_FACETS
  .map(f => `- "${f.id}" (${f.label}): 0 = ${f.low}, 1 = ${f.high}. ${f.description}`)
  .join('\n')

const READ_PROMPT = `You are an art director reading a person's TASTE from the inspiration images above. Images are numbered from 0 in the order given.

Rate the shared sensibility of the set on these 12 facets, each as a number 0..1 between the named endpoints:
${FACET_LIST}

Rules:
- CLUSTER BEFORE AVERAGING. First decide whether the images form ONE coherent register or 2+ distinct ones (e.g. a brutalist monochrome set alongside a warm textured set). If they split, do NOT average across the split — return per-cluster readings in "clusters", each with a short label and its own image indices as evidence. If one register, set "clusters" to null.
- Confidence is honesty, not politeness. A facet you cannot actually see gets low confidence — "motion" from still images should come back near-zero confidence. Do not guess a confident 0.5.
- "evidence" lists the image indices that most pushed each facet's value.
- "avoids" are negative priors: things this taste clearly never does, as short phrases (e.g. "no neon accents", "no pure white backgrounds"). 3–8 of them, grounded in the set.
- Judge only visual treatment — never identify real people, brands, or artists.

- "summary" is you SHOWING you understood the set: 2–3 sentences naming the world these images live in — light, place-feel, mood, material, era — in plain confident art-director language. Not a list of facets.
- "briefs" are THREE style directions for reproducing this vibe as an ABSTRACT GRADIENT composition, each translating a DIFFERENT aspect of the set:
  1. label "atmosphere" — translate the LIGHT AND AIR: how the sky/ambient light in these images behaves as a colour field. This is the default reading of a photographed world — the objects in the photos contribute PALETTE ONLY, never composition. A set of buildings under soft sky should brief as a soft sky-like wash, not as bands shaped like the buildings.
  2. label "structure" — translate the set's geometry/graphic character (only meaningful where the set itself is graphic/poster-like; still honest to attempt).
  3. label "essence" — your best single call on the set's most distinctive quality, whatever aspect that is.
  Each is ONE dense standalone line and MUST name exactly one composition archetype from this menu (the studio's real vocabulary): "soft liquid marble wash" · "aurora colour wash" · "radial sunset glow" · "soft mesh blobs" · "crisp linear bands" · "embossed oil". Then actual colours, light, and finish.

Return STRICT JSON only — no prose, no markdown fences, exactly this shape:
{
  "summary": "...",
  "briefs": [ { "label": "atmosphere", "text": "..." }, { "label": "structure", "text": "..." }, { "label": "essence", "text": "..." } ],
  "facets": { "<facetId>": { "value": 0..1, "confidence": 0..1, "evidence": [imageIndices] }, ... all 12 ids ... },
  "avoids": ["..."],
  "clusters": null | [ { "label": "...", "imageIndices": [..], "facets": { same shape }, "avoids": ["..."] }, ... ]
}`

/** Strip code fences / prose and parse the outermost JSON object. Null when hopeless. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  }
  catch { return null }
}

/** Clamp + shape one raw facets record into TasteReading['facets']. */
function parseFacets(raw: unknown): TasteReading['facets'] {
  const out: TasteReading['facets'] = {}
  const rec = raw as Record<string, { value?: unknown; confidence?: unknown; evidence?: unknown }> | null
  if (!rec || typeof rec !== 'object') return out
  for (const id of FACET_IDS) {
    const f = rec[id]
    if (!f || typeof f !== 'object') continue
    const sources = Array.isArray(f.evidence)
      ? f.evidence.filter((e): e is number => typeof e === 'number').map(i => `image-${i}`)
      : undefined
    out[id as FacetId] = facetReading(f.value, f.confidence, sources)
  }
  return out
}

function parseAvoids(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === 'string' && !!a.trim()).map(a => a.trim()).slice(0, 12)
    : []
}

function parseReading(obj: Record<string, unknown>): TasteReading {
  const reading: TasteReading = {
    facets: parseFacets(obj.facets),
    avoids: parseAvoids(obj.avoids),
  }
  if (Array.isArray(obj.clusters) && obj.clusters.length >= 2) {
    reading.clusters = obj.clusters
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => {
        const cluster: TasteReading = { facets: parseFacets(c.facets), avoids: parseAvoids(c.avoids) }
        if (typeof c.label === 'string' && c.label.trim()) cluster.label = c.label.trim()
        return cluster
      })
  }
  return reading
}

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody(event) as { images?: unknown, apiKey?: unknown }
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

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-fable-5', // thinking is always on for Fable — do NOT send a `thinking` field
        max_tokens: 2048,
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: READ_PROMPT }] }],
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
  const obj = extractJsonObject(text)
  if (!obj) {
    throw createError({ statusCode: 502, statusMessage: `Model returned unparseable JSON: ${text.slice(0, 200)}` })
  }

  const briefs = (Array.isArray(obj.briefs) ? obj.briefs : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map(b => ({
      label: typeof b.label === 'string' ? b.label.trim() : '',
      text: typeof b.text === 'string' ? b.text.trim() : '',
    }))
    .filter(b => b.text)
    .slice(0, 3)

  return {
    reading: parseReading(obj),
    summary: typeof obj.summary === 'string' ? obj.summary.trim() : '',
    briefs,
  }
})
