/**
 * List all saved layout templates. Returns metadata only (no element bodies)
 * so the gallery loads fast even with dozens of templates. Handles both v1
 * (aspects) and v2 (formats) schemas.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const LAYOUTS_DIR = join(process.cwd(), 'server', 'templates', 'layouts')

export default defineEventHandler(async () => {
  const files = await readdir(LAYOUTS_DIR).catch(() => [])
  const items = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map(async (f) => {
      try {
        const raw = await readFile(join(LAYOUTS_DIR, f), 'utf8')
        const t = JSON.parse(raw) as Record<string, any>
        const formats = t.formats ?? t.aspects ?? {}
        return {
          id: t.id,
          name: t.name,
          file: f,
          version: t.version ?? 1,
          formatCount: Object.keys(formats).length,
          elementCount: Array.isArray(t.elements) ? t.elements.length : 0,
        }
      } catch {
        return null
      }
    }),
  )
  return { items: items.filter(Boolean) }
})
