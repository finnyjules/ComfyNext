/** Upsert a moodboard. Body is the full MoodboardEntry; URL id must match. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateMoodboardEntry, MOODBOARD_ID_RE } from '../../../shared/taste/moodboard'

const DIR = join(process.cwd(), 'server', 'moodboards')

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
  entry.updatedAt = new Date().toISOString()
  await mkdir(DIR, { recursive: true })
  await writeFile(join(DIR, `${id}.json`), JSON.stringify(entry, null, 2), 'utf8')
  return entry
})
