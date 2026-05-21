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

interface LoadedFont {
  name: string
  data: ArrayBuffer
  weight: 400 | 700
  style: 'normal'
}

// Lazy-loaded font cache. Satori needs ArrayBuffers, and disk reads are slow
// enough that we don't want to repeat them per request.
let fontsCache: LoadedFont[] | null = null

async function loadFonts(): Promise<LoadedFont[]> {
  if (fontsCache) return fontsCache
  const fontsDir = join(process.cwd(), 'server', 'templates', 'fonts')
  const [regular, bold] = await Promise.all([
    readFile(join(fontsDir, 'Inter-Regular.woff')),
    readFile(join(fontsDir, 'Inter-Bold.woff')),
  ])
  fontsCache = [
    { name: 'Inter', data: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength), weight: 400, style: 'normal' },
    { name: 'Inter', data: bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength), weight: 700, style: 'normal' },
  ]
  return fontsCache
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RenderRequest>(event)
  if (!body?.template) {
    throw createError({ statusCode: 400, statusMessage: 'Missing `template` in request body.' })
  }

  const fonts = await loadFonts()

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
