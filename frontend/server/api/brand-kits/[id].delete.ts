import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const KITS_DIR = join(process.cwd(), 'server', 'brand-kits')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  await rm(join(KITS_DIR, `${id}.json`), { force: true })
  return { ok: true, id }
})
