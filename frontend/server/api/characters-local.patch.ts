import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseCharacterRecord, validRefFilename } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    slug?: string, name?: string, notes?: string, loraName?: string | null,
    trigger?: string | null, refImages?: string[], coverIndex?: number, remove?: true,
  }
  const slug = (body?.slug || '').trim()
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid slug' })
  }
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  const file = path.join(dir, `${slug}.json`)
  let record
  try { record = parseCharacterRecord(await fs.readFile(file, 'utf8'), slug) }
  catch { throw createError({ statusCode: 404, message: `No character '${slug}'` }) }
  if (!record) throw createError({ statusCode: 404, message: `No character '${slug}'` })

  if (body.remove === true) {
    // Ref files stay in the input dir — other shots may still point at them.
    await fs.unlink(file)
    return { ok: true }
  }
  if (typeof body.name === 'string' && body.name.trim()) record.name = body.name.trim()
  if (typeof body.notes === 'string') record.notes = body.notes
  if (body.loraName !== undefined) record.loraName = body.loraName || null
  if (body.trigger !== undefined) record.trigger = body.trigger || null
  if (Array.isArray(body.refImages)) {
    if (!body.refImages.every(validRefFilename)) {
      throw createError({ statusCode: 400, message: 'Invalid ref filename' })
    }
    record.refImages = body.refImages
  }
  if (typeof body.coverIndex === 'number') {
    record.coverIndex = Math.min(Math.max(0, body.coverIndex), Math.max(0, record.refImages.length - 1))
  }
  record.updatedAt = new Date().toISOString()
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return { ok: true }
})
