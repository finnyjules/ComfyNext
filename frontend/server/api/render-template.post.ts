/**
 * Render a template layout to a PNG.
 *
 * POST body: RenderRequest (see ../templates/schema.ts).
 * Returns: image/png bytes.
 *
 * Architecture: layout JSON → satori (SVG) → resvg (PNG). Both libraries are
 * pure JS, no native browser needed. Fonts are loaded once at startup and
 * reused across renders.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'

import type { RenderRequest } from '~~/server/templates/schema'
import { templateToSatori } from '~~/server/templates/translate'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'
import { resolveTokens } from '~~/shared/template-grid/tokens'

interface LoadedFont {
  name: string
  data: ArrayBuffer
  weight: 400 | 700
  style: 'normal'
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// Curated families (shared/template-fonts.ts) — read once from node_modules.
let curatedCache: LoadedFont[] | null = null

async function loadCuratedFonts(): Promise<LoadedFont[]> {
  if (curatedCache) return curatedCache
  const out: LoadedFont[] = []
  for (const fam of TEMPLATE_FONTS) {
    for (const w of fam.weights) {
      try {
        const buf = await readFile(join(process.cwd(), 'node_modules', w.modulePath))
        out.push({ name: fam.name, data: toArrayBuffer(buf), weight: w.weight, style: 'normal' })
      } catch {
        // Missing fontsource file — skip; Inter (also curated) still covers.
      }
    }
  }
  curatedCache = out
  return out
}

// Non-curated families picked in the editor's font picker: fetch TTFs from
// Google Fonts on first use and cache for the process lifetime. A non-browser
// User-Agent makes Google return TTF sources — satori can't parse woff2.
const googleCache = new Map<string, LoadedFont[]>()
const googleFailed = new Set<string>()

async function loadGoogleFamily(family: string): Promise<LoadedFont[]> {
  const cached = googleCache.get(family)
  if (cached) return cached
  if (googleFailed.has(family)) return []
  try {
    const f = encodeURIComponent(family).replace(/%20/g, '+')
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=${f}:wght@400;700&display=swap`,
      { headers: { 'User-Agent': 'curl/8' } },
    )
    if (!cssRes.ok) throw new Error(`css ${cssRes.status}`)
    const css = await cssRes.text()
    const fonts: LoadedFont[] = []
    for (const block of css.split('@font-face').slice(1)) {
      const weight = /font-weight:\s*(\d+)/.exec(block)?.[1]
      const url = /src:\s*url\(([^)]+\.ttf)\)/.exec(block)?.[1]
      if (!url || (weight !== '400' && weight !== '700')) continue
      const ttf = await fetch(url)
      if (!ttf.ok) continue
      fonts.push({ name: family, data: await ttf.arrayBuffer(), weight: Number(weight) as 400 | 700, style: 'normal' })
    }
    if (!fonts.length) throw new Error('no ttf faces')
    googleCache.set(family, fonts)
    return fonts
  } catch {
    googleFailed.add(family)  // don't re-fetch a broken family every render
    return []
  }
}

/** Every fontFamily referenced by the template (v1 incl. per-aspect
 * overrides, v2 element styles). `{{ brand.* }}` tokens resolve against the
 * merged brand so brand-bound fonts are fetched too. */
function collectFamilies(template: unknown, brand: Record<string, unknown>): string[] {
  const fams = new Set<string>()
  const resolve = (f: unknown) => {
    if (typeof f !== 'string' || !f.trim()) return
    const r = String(resolveTokens(f.trim(), {}, brand)).trim()
    if (r) fams.add(r)
  }
  const elements = (template as { elements?: unknown[] })?.elements ?? []
  for (const el of elements as any[]) {
    resolve(el?.style?.fontFamily)
    for (const ov of Object.values(el?.overrides ?? {})) resolve((ov as any)?.style?.fontFamily)
  }
  return [...fams]
}

async function loadFonts(template: unknown, brand: Record<string, unknown>): Promise<LoadedFont[]> {
  const merged = { ...((template as any)?.brand ?? {}), ...brand }
  const curated = await loadCuratedFonts()
  const curatedNames = new Set(curated.map(f => f.name))
  const extra = (await Promise.all(
    collectFamilies(template, merged).filter(n => !curatedNames.has(n)).map(loadGoogleFamily),
  )).flat()
  return [...curated, ...extra]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RenderRequest>(event)
  if (!body?.template) {
    throw createError({ statusCode: 400, statusMessage: 'Missing `template` in request body.' })
  }

  const fonts = await loadFonts(body.template, (body.brand ?? {}) as Record<string, unknown>)

  const { tree, width, height } = templateToSatori(
    body.template,
    body.aspect,
    body.props ?? {},
    body.brand ?? {},
    body.width && body.height ? { width: body.width, height: body.height } : undefined,
  )

  // Satori's first arg is "any" because it accepts ReactNode-shaped objects.
  // Our `tree` matches that shape (type/props/children) without pulling React.
  const svg = await satori(tree as any, {
    width,
    height,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  })

  // SVG → PNG via resvg. fitTo:original honours the size satori already sized to.
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' } })
  const png = resvg.render().asPng()

  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'no-store')
  return png
})
