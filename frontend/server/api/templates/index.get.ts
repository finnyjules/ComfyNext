/**
 * List all saved layout templates. Returns metadata only (no element bodies)
 * so the gallery loads fast even with dozens of templates. Handles both v1
 * (aspects) and v2 (formats) schemas.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { listOwned } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'template', dir: storeDir('templates-layouts') }

type TemplateItem = { id: string, record: Record<string, any> }

async function readAllTemplates(): Promise<TemplateItem[]> {
  const files = await readdir(OPTS.dir).catch(() => [])
  const items = await Promise.all(
    files.filter((f) => f.endsWith('.json')).map(async (f): Promise<TemplateItem | null> => {
      try {
        const raw = await readFile(join(OPTS.dir, f), 'utf8')
        const t = JSON.parse(raw) as Record<string, any>
        const formats = t.formats ?? t.aspects ?? {}
        return {
          id: basename(f, '.json'),
          record: {
            id: t.id,
            name: t.name,
            file: f,
            version: t.version ?? 1,
            formatCount: Object.keys(formats).length,
            elementCount: Array.isArray(t.elements) ? t.elements.length : 0,
          },
        }
      } catch {
        return null
      }
    }),
  )
  return items.filter((i): i is TemplateItem => i !== null)
}

export default defineEventHandler(async (event) => {
  const items = await listOwned(OPTS, event.context.userId ?? null, readAllTemplates)
  return { items }
})
