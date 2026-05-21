/**
 * Load one template by id. We map id → file by reading + filtering the
 * directory; matches our save path (id is also the filename without .json).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Template } from '~~/server/templates/schema'

const LAYOUTS_DIR = join(process.cwd(), 'server', 'templates', 'layouts')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  // Restrict to a safe id pattern to avoid path traversal.
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  try {
    const raw = await readFile(join(LAYOUTS_DIR, `${id}.json`), 'utf8')
    return JSON.parse(raw) as Template
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      throw createError({ statusCode: 404, statusMessage: `Template '${id}' not found` })
    }
    throw createError({ statusCode: 500, statusMessage: e?.message ?? 'Read failed' })
  }
})
