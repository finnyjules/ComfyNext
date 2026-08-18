/**
 * Load one template by id. We map id → file by reading + filtering the
 * directory; matches our save path (id is also the filename without .json).
 *
 * Stage 6 (Task 4): hosted read-guards by template ownership — a template you
 * don't own (and that isn't curated/unowned) 404s, no existence disclosure.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Template } from '~~/server/templates/schema'
import { ownerOf } from '../../utils/resourceOwners'
import { isHosted } from '../../utils/deployMode'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'template', dir: storeDir('templates-layouts') }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  // Restrict to a safe id pattern to avoid path traversal.
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  if (isHosted()) {
    const userId = event.context.userId ?? null
    const owner = await ownerOf(OPTS.kind, id)
    // Readable iff curated/unowned (owner === null) or owned by the caller.
    if (!(owner === null || owner === userId)) {
      throw createError({ statusCode: 404, statusMessage: `Template '${id}' not found` })
    }
  }
  try {
    const raw = await readFile(join(OPTS.dir, `${id}.json`), 'utf8')
    return JSON.parse(raw) as Template
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      throw createError({ statusCode: 404, statusMessage: `Template '${id}' not found` })
    }
    throw createError({ statusCode: 500, statusMessage: e?.message ?? 'Read failed' })
  }
})
