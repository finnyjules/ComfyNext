/** Remove an uploaded brand font: its files + manifest entry. */
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { readManifest, writeManifest, USER_FONTS_DIR } from '~~/server/templates/fonts-store'
import { guardMutation, releaseRecord } from '../../utils/ownedJsonStore'

const OPTS = { kind: 'template-font', dir: USER_FONTS_DIR }

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })
  }
  const manifest = await readManifest()
  const entry = manifest.find(f => f.slug === slug)
  await guardMutation(OPTS, event.context.userId ?? null, slug, Boolean(entry))
  if (entry) {
    // De-dupe filenames (a mirrored single weight shares one file).
    for (const file of new Set(Object.values(entry.weights))) {
      await unlink(join(USER_FONTS_DIR, file)).catch(() => {})
    }
  }
  await writeManifest(manifest.filter(f => f.slug !== slug))
  await releaseRecord(OPTS, slug)
  return { ok: true }
})
