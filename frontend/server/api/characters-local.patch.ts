import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  parseCharacterRecord, stateHygiene, validRefFilename,
  type CharacterRecord, type CharacterState,
} from '~~/server/utils/characterRegistry'
import { applyStatePatch, type StatePatchBody } from '~~/server/utils/characterStatePatch'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as {
    slug?: string, name?: string, notes?: string, loraName?: string | null,
    trigger?: string | null,
    states?: CharacterState[], statePatch?: StatePatchBody, remove?: true,
    expectedUpdatedAt?: string,
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

  if (body.statePatch) {
    const result = applyStatePatch(record, body.statePatch, new Date().toISOString())
    if (!result.ok) throw createError({ statusCode: result.code, message: result.message })
    record = result.record
    await fs.writeFile(file, JSON.stringify(record, null, 2))
    return { ok: true }
  }

  if (Array.isArray(body.states)) {
    // Record-level staleness guard, mirroring applyStatePatch's per-state
    // check above — full-array replaces (create/delete-variant) otherwise
    // clobber a concurrent edit with no warning. Omitted expectedUpdatedAt
    // keeps legacy callers working unguarded.
    // NOTE: no Nitro test harness for this route (established pattern, see
    // the statePatch branch above) — covered indirectly via
    // characters-composable.unit.spec.ts at the store layer.
    if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt !== record.updatedAt) {
      throw createError({ statusCode: 409, message: 'Character was modified by someone else' })
    }
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
    // Run each submitted state through the same hygiene used on parse —
    // preserves caller-supplied panels/sheetImage/status/stressResult/
    // updatedAt instead of clobbering them with a hardcoded literal.
    const hygienic = states.map(v => stateHygiene(v as unknown as Record<string, unknown>))
    if (hygienic.some(v => !v)) {
      throw createError({ statusCode: 400, message: 'Invalid state' })
    }
    const candidate: CharacterRecord = {
      ...record,
      states: hygienic as CharacterState[],
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

  // NOTE: the legacy top-level `refImages`/`coverIndex` alias (write-through
  // to the Default state) was removed in Task 9 — every caller now goes
  // through `statePatch` (applyStatePatch, above) or a full `states` replace.
  // `applyStatePatch` is the only remaining per-state mutation path.

  record.updatedAt = new Date().toISOString()
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return { ok: true }
})
