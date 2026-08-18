/** Upsert a brand kit. Body is the full BrandKitEntry; URL id must match. */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claimNew, guardMutation } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'brand-kit', dir: storeDir('brand-kits') }

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
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Kit needs a name' })
  }
  if (!body.kit || typeof body.kit !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Kit needs a kit object' })
  }
  const userId = event.context.userId ?? null
  const exists = existsSync(join(OPTS.dir, `${id}.json`))
  await guardMutation(OPTS, userId, id, exists)
  body.updatedAt = new Date().toISOString()
  await mkdir(OPTS.dir, { recursive: true })
  await writeFile(join(OPTS.dir, `${id}.json`), JSON.stringify(body, null, 2), 'utf8')
  if (!exists) await claimNew(OPTS, userId, id)
  return { ok: true, id }
})
