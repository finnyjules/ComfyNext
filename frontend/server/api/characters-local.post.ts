import { promises as fs } from 'node:fs'
import path from 'node:path'
import { slugifyCharacterName, type CharacterRecord } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { name?: string }
  const name = (body?.name || '').trim()
  const slug = slugifyCharacterName(name)
  if (!name || !slug) throw createError({ statusCode: 400, message: 'A usable character name is required' })

  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${slug}.json`)
  try { await fs.access(file); throw createError({ statusCode: 409, message: `Character '${slug}' already exists` }) }
  catch (e: any) { if (e?.statusCode === 409) throw e }

  const now = new Date().toISOString()
  const record: CharacterRecord = {
    name, slug, refImages: [], coverIndex: 0,
    loraName: null, trigger: null, notes: '', createdAt: now, updatedAt: now,
  }
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return record
})
