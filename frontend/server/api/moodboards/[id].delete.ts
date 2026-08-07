import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { MOODBOARD_ID_RE } from '../../../shared/taste/moodboard'

const DIR = join(process.cwd(), 'server', 'moodboards')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !MOODBOARD_ID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  await rm(join(DIR, `${id}.json`), { force: true })
  return { ok: true, id }
})
