/**
 * List all saved layout templates. Returns metadata only (no element bodies)
 * so the gallery loads fast even with dozens of templates.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Template } from '~~/server/templates/schema'

const LAYOUTS_DIR = join(process.cwd(), 'server', 'templates', 'layouts')

export default defineEventHandler(async () => {
  const files = await readdir(LAYOUTS_DIR).catch(() => [])
  const items = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map(async (f) => {
      try {
        const raw = await readFile(join(LAYOUTS_DIR, f), 'utf8')
        const t = JSON.parse(raw) as Template
        return {
          id: t.id,
          name: t.name,
          file: f,
          aspectCount: Object.keys(t.aspects ?? {}).length,
          elementCount: t.elements?.length ?? 0,
        }
      } catch {
        return null
      }
    }),
  )
  return { items: items.filter(Boolean) }
})
