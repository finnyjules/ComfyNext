import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { MOODBOARD_ID_RE } from '../../../shared/taste/moodboard'
import { guardMutation, releaseRecord } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'moodboard', dir: storeDir('moodboards') }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !MOODBOARD_ID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const exists = existsSync(join(OPTS.dir, `${id}.json`))
  await guardMutation(OPTS, event.context.userId ?? null, id, exists)
  await rm(join(OPTS.dir, `${id}.json`), { force: true })
  await releaseRecord(OPTS, id)
  return { ok: true, id }
})
