/** Upsert a moodboard. Body is the full MoodboardEntry; URL id must match. */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateMoodboardEntry, MOODBOARD_ID_RE } from '../../../shared/taste/moodboard'
import { claimNew, guardMutation } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'moodboard', dir: storeDir('moodboards') }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !MOODBOARD_ID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<Record<string, any>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  }
  if (body.id !== id) {
    throw createError({ statusCode: 400, statusMessage: `Body id '${body.id}' doesn't match URL id '${id}'` })
  }
  let entry
  try {
    entry = validateMoodboardEntry(body)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : 'Invalid moodboard entry' })
  }
  const userId = event.context.userId ?? null
  const exists = existsSync(join(OPTS.dir, `${id}.json`))
  await guardMutation(OPTS, userId, id, exists)
  entry.updatedAt = new Date().toISOString()
  await mkdir(OPTS.dir, { recursive: true })
  await writeFile(join(OPTS.dir, `${id}.json`), JSON.stringify(entry, null, 2), 'utf8')
  if (!exists) await claimNew(OPTS, userId, id)
  return entry
})
