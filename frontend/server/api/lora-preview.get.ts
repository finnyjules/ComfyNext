/**
 * GET /api/lora-preview?path=<owner>/<repo>
 *
 * Returns a single preview image URL for a HuggingFace model, used by the
 * LoRA Library panel to render visual tile backgrounds.
 *
 * Resolution strategy, in order:
 *   1. `cardData.widget[*].output.url` — example outputs the uploader curated
 *      in their README. Usually the prettiest.
 *   2. `siblings` — every file in the repo. Filter to images, pick the first
 *      under common preview-folder names (images/, samples/, examples/).
 *
 * The CDN URL the client gets is huggingface.co/.../resolve/main/<rfilename>
 * — public and CORS-friendly for direct `<img>` use.
 */
export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? '').trim()
  if (!path || !/^[\w.-]+\/[\w.-]+$/.test(path)) {
    throw createError({ statusCode: 400, message: 'path must be "owner/repo"' })
  }

  let info: any
  try {
    const r = await fetch(`https://huggingface.co/api/models/${path}`)
    if (!r.ok) {
      throw createError({ statusCode: r.status, message: `HF API ${r.status}` })
    }
    info = await r.json()
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      message: `Couldn't reach HuggingFace: ${err?.message ?? err}`,
    })
  }

  const fromCardData = pickWidgetExample(info?.cardData?.widget)
  if (fromCardData) {
    return { url: resolveUrl(path, fromCardData) }
  }

  const fromSiblings = pickFromSiblings(info?.siblings)
  if (fromSiblings) {
    return { url: resolveUrl(path, fromSiblings) }
  }

  return { url: null as string | null }
})

function pickWidgetExample(widget: unknown): string | null {
  if (!Array.isArray(widget)) return null
  for (const w of widget) {
    const url = w?.output?.url
    if (typeof url === 'string' && url.length > 0) {
      // Some widget URLs are already absolute; resolveUrl handles both.
      return url
    }
  }
  return null
}

// Folders we prefer when picking from siblings — uploaders usually put
// preview shots in one of these. Files at the repo root are accepted too,
// but ranked lower so a curated `examples/` shot wins over `cover.png`.
const PREFERRED_PREFIXES = ['images/', 'samples/', 'examples/', 'example_images/', 'preview/']
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

function pickFromSiblings(siblings: unknown): string | null {
  if (!Array.isArray(siblings)) return null
  const images = siblings
    .map((s: any) => String(s?.rfilename ?? ''))
    .filter((n) => n && IMAGE_EXT.test(n))

  // Bucket by preferred prefix, then alphabetical within bucket so picks are
  // deterministic across reloads.
  for (const prefix of PREFERRED_PREFIXES) {
    const match = images.filter((n) => n.startsWith(prefix)).sort()
    if (match.length) return match[0]!
  }
  // Fall back to any image file (e.g. "cover.png" at repo root).
  const rest = images.filter((n) => !n.includes('/')).sort()
  return rest[0] ?? null
}

function resolveUrl(path: string, rfilenameOrUrl: string): string {
  if (rfilenameOrUrl.startsWith('http')) return rfilenameOrUrl
  return `https://huggingface.co/${path}/resolve/main/${rfilenameOrUrl}`
}
