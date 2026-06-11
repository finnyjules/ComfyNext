/**
 * Save (create or overwrite) a template. Body is the full Template JSON; the
 * id in the URL must match `template.id`. Accepts both v1 (aspects) and v2
 * (formats) schemas.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LAYOUTS_DIR = join(process.cwd(), 'server', 'templates', 'layouts')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<Record<string, any>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  }
  if (body.id !== id) {
    throw createError({ statusCode: 400, statusMessage: `Body id '${body.id}' doesn't match URL id '${id}'` })
  }
  if (body.version !== 1 && body.version !== 2) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported schema version ${body.version}` })
  }
  const slots = body.version === 2 ? body.formats : body.aspects
  if (!slots || Object.keys(slots).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Template needs at least one format' })
  }
  await writeFile(
    join(LAYOUTS_DIR, `${id}.json`),
    JSON.stringify(body, null, 2),
    'utf8',
  )
  return { ok: true, id }
})
