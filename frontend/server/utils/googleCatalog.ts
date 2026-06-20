/**
 * Shared Google Fonts catalog loader. The metadata endpoint isn't CORS-friendly
 * and ships JSON behind an XSSI guard (`)]}'`), so we fetch + clean it server-side
 * and cache in-memory for a day. Used by /api/google-fonts (the picker catalog)
 * and /api/font-suggest (grounding LLM suggestions against real families).
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

export interface GoogleFont {
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

export async function getGoogleCatalog(): Promise<GoogleFont[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.fonts

  let raw: string
  try {
    const r = await fetch(SOURCE, { headers: { Accept: 'application/json' } })
    if (!r.ok) throw createError({ statusCode: 502, message: `Google Fonts metadata ${r.status}` })
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
  return fonts
}
