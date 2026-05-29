/**
 * GET /api/google-fonts
 *
 * Returns the full Google Fonts catalog as a slim list the Font Playground's
 * picker can search. Proxied server-side because Google's metadata endpoint
 * (https://fonts.google.com/metadata/fonts) isn't CORS-friendly and ships its
 * JSON behind an XSSI guard prefix (`)]}'`). No API key required.
 *
 * Response: `{ fonts: GoogleFont[], count: number }` where
 *   GoogleFont = { family, category, weights:number[], italic:boolean,
 *                  axes:[{tag,min,max,default}] }
 * Fonts with `axes` are variable (the picker shows axis sliders); the rest get
 * a weight dropdown. Cached in memory for a day — the catalog barely moves.
 */
const SOURCE = 'https://fonts.google.com/metadata/fonts'
const TTL_MS = 24 * 60 * 60 * 1000

const CATEGORY: Record<string, string> = {
  'Sans Serif': 'sans',
  'Serif': 'serif',
  'Display': 'display',
  'Monospace': 'mono',
  'Handwriting': 'handwriting',
}

// Show the familiar axes first; everything else keeps its catalog order after.
const AXIS_ORDER = ['wght', 'wdth', 'slnt', 'opsz', 'ital']

interface GoogleFont {
  family: string
  category: string
  weights: number[]
  italic: boolean
  axes: { tag: string; min: number; max: number; default: number }[]
}

let cache: { at: number; fonts: GoogleFont[] } | null = null

function transform(list: any[]): GoogleFont[] {
  const out: GoogleFont[] = []
  for (const meta of list) {
    if (!meta || typeof meta.family !== 'string') continue
    const keys = Object.keys(meta.fonts ?? {})
    const weights = [...new Set(
      keys.filter(k => !k.endsWith('i')).map(k => parseInt(k, 10)).filter(Number.isFinite),
    )].sort((a, b) => a - b)
    const axes = (Array.isArray(meta.axes) ? meta.axes : [])
      .map((a: any) => ({ tag: String(a.tag), min: +a.min, max: +a.max, default: +a.defaultValue }))
      .sort((x: any, y: any) => {
        const ix = AXIS_ORDER.indexOf(x.tag), iy = AXIS_ORDER.indexOf(y.tag)
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
      })
    out.push({
      family: meta.family,
      category: CATEGORY[meta.category] ?? 'sans',
      weights: weights.length ? weights : [400],
      italic: keys.some(k => k.endsWith('i')),
      axes,
    })
  }
  return out
}

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { fonts: cache.fonts, count: cache.fonts.length }
  }

  let raw: string
  try {
    const r = await fetch(SOURCE, { headers: { Accept: 'application/json' } })
    if (!r.ok) {
      throw createError({ statusCode: 502, message: `Google Fonts metadata ${r.status}` })
    }
    raw = await r.text()
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({ statusCode: 502, message: `Couldn't reach Google Fonts: ${err?.message ?? err}` })
  }

  let data: any
  try {
    data = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''))
  } catch {
    throw createError({ statusCode: 502, message: 'Google Fonts metadata was not valid JSON' })
  }

  const fonts = transform(data?.familyMetadataList ?? [])
  cache = { at: Date.now(), fonts }
  return { fonts, count: fonts.length }
})
