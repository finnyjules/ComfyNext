/**
 * Serve an uploaded font file for browser @font-face preview. Only filenames
 * referenced by the manifest are served (exact match — no path traversal).
 *
 * Stage 6 (Task 4): hosted read-guards by the owning font's slug — a file that
 * belongs to another user's font (and isn't curated/unowned) 404s.
 */
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { readManifest, USER_FONTS_DIR } from '~~/server/templates/fonts-store'
import { ownerOf } from '../../../utils/resourceOwners'
import { isHosted } from '../../../utils/deployMode'

const MIME: Record<string, string> = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff' }

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Missing name' })

  const manifest = await readManifest()
  const owningEntry = manifest.find(f => Object.values(f.weights).includes(name))
  if (!owningEntry) throw createError({ statusCode: 404, statusMessage: 'Unknown font' })

  if (isHosted()) {
    const userId = event.context.userId ?? null
    const owner = await ownerOf('template-font', owningEntry.slug)
    // Readable iff curated/unowned or owned by the caller.
    if (!(owner === null || owner === userId)) {
      throw createError({ statusCode: 404, statusMessage: 'Unknown font' })
    }
  }

  const buf = await readFile(join(USER_FONTS_DIR, name)).catch(() => null)
  if (!buf) throw createError({ statusCode: 404, statusMessage: 'Font file missing' })

  setHeader(event, 'content-type', MIME[extname(name).toLowerCase()] ?? 'application/octet-stream')
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return buf
})
