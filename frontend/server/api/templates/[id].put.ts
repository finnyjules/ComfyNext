/**
 * Save (create or overwrite) a template. Body is the full Template JSON; the
 * id in the URL must match `template.id`.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Template } from '~~/server/templates/schema'
import { SCHEMA_VERSION } from '~~/server/templates/schema'

const LAYOUTS_DIR = join(process.cwd(), 'server', 'templates', 'layouts')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<Template>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  }
  if (body.id !== id) {
    throw createError({ statusCode: 400, statusMessage: `Body id '${body.id}' doesn't match URL id '${id}'` })
  }
  if (body.version !== SCHEMA_VERSION) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported schema version ${body.version}` })
  }
  if (!body.aspects || Object.keys(body.aspects).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Template needs at least one aspect' })
  }
  await writeFile(
    join(LAYOUTS_DIR, `${id}.json`),
    JSON.stringify(body, null, 2),
    'utf8',
  )
  return { ok: true, id }
})
