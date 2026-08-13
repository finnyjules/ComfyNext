import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  parseCharacterRecord, validRefFilename,
  type CharacterRecord, type CharacterState,
} from '~~/server/utils/characterRegistry'
import { defaultState } from '#shared/characters/types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    slug?: string, name?: string, notes?: string, loraName?: string | null,
    trigger?: string | null, refImages?: string[], coverIndex?: number,
    states?: CharacterState[], remove?: true,
  }
  const slug = (body?.slug || '').trim()
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid slug' })
  }
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  const file = path.join(dir, `${slug}.json`)
  let record: CharacterRecord | null
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

  if (Array.isArray(body.states)) {
    const states = body.states
    const ids = states.map(v => v?.id)
    if (states.length === 0
      || !states.every(v => v && typeof v.id === 'string' && v.id.trim() && typeof v.label === 'string' && v.label.trim())
      || !states.every(v => Array.isArray(v.refImages) && v.refImages.every(validRefFilename))
    ) {
      throw createError({ statusCode: 400, message: 'Invalid state' })
    }
    if (new Set(ids).size !== ids.length) {
      throw createError({ statusCode: 400, message: 'Duplicate state id' })
    }
    if (ids.filter(id => id === 'default').length !== 1) {
      throw createError({ statusCode: 400, message: 'Exactly one default state is required' })
    }
    const candidate: CharacterRecord = {
      ...record,
      states: states.map(v => ({
        id: v.id,
        label: v.label,
        descriptor: typeof v.descriptor === 'string' ? v.descriptor : '',
        refImages: v.refImages,
        coverIndex: typeof v.coverIndex === 'number' ? v.coverIndex : 0,
        // Panels/sheet/status/stressResult are Task 3's surface — mechanical
        // rename here just keeps this route compiling; stateHygiene fills
        // the same defaults on the round-trip parse below anyway.
        panels: [],
        sheetImage: null,
        status: 'draft' as const,
        stressResult: null,
        updatedAt: '',
      })),
    }
    // Round-trip through the same hygiene parse used on read — 400 if a
    // state got dropped or altered rather than silently persisting drift.
    const healed = parseCharacterRecord(JSON.stringify(candidate), slug)
    if (!healed || healed.states.length !== candidate.states.length) {
      throw createError({ statusCode: 400, message: 'Invalid state' })
    }
    record = healed
    record.name = candidate.name
    record.notes = candidate.notes
    record.loraName = candidate.loraName
    record.trigger = candidate.trigger
  }

  // Legacy alias: refImages/coverIndex at top level write through to the
  // Default state. Existing callers (save-as-character, CharacterSheetNode,
  // panel uploads) still send this shape.
  if (Array.isArray(body.refImages)) {
    if (!body.refImages.every(validRefFilename)) {
      throw createError({ statusCode: 400, message: 'Invalid ref filename' })
    }
    const def = defaultState(record)
    def.refImages = body.refImages
    def.coverIndex = Math.min(Math.max(0, def.coverIndex), Math.max(0, def.refImages.length - 1))
  }
  if (typeof body.coverIndex === 'number') {
    const def = defaultState(record)
    def.coverIndex = Math.min(Math.max(0, body.coverIndex), Math.max(0, def.refImages.length - 1))
  }

  record.updatedAt = new Date().toISOString()
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return { ok: true }
})
