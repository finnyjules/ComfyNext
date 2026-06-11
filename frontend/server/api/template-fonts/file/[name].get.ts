/**
 * Serve an uploaded font file for browser @font-face preview. Only filenames
 * referenced by the manifest are served (exact match — no path traversal).
 */
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { readManifest, USER_FONTS_DIR } from '~~/server/templates/fonts-store'

const MIME: Record<string, string> = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff' }

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Missing name' })

  const manifest = await readManifest()
  const known = new Set(manifest.flatMap(f => Object.values(f.weights)))
  if (!known.has(name)) throw createError({ statusCode: 404, statusMessage: 'Unknown font' })

  const buf = await readFile(join(USER_FONTS_DIR, name)).catch(() => null)
  if (!buf) throw createError({ statusCode: 404, statusMessage: 'Font file missing' })

  setHeader(event, 'content-type', MIME[extname(name).toLowerCase()] ?? 'application/octet-stream')
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return buf
})
