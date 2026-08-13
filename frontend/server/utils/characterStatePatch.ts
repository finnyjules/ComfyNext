/**
 * Pure per-state PATCH logic for the character registry. Consumed by the
 * `characters-local` PATCH route's `statePatch` branch; the route stays
 * IO-only (read record, call this, write record). Kept fs-free so it
 * unit-tests without Nitro, same as characterRegistry.ts.
 */
import type { CharacterRecord, CharacterState } from '#shared/characters/types'
import { stateHygiene } from './characterRegistry'

export interface StatePatchBody {
  stateId: string
  expectedUpdatedAt?: string
  patch: Partial<Pick<CharacterState, 'label' | 'descriptor' | 'refImages' | 'coverIndex' | 'panels' | 'sheetImage' | 'status' | 'stressResult'>>
}

export type StatePatchResult =
  | { ok: true, record: CharacterRecord }
  | { ok: false, code: 400 | 404 | 409, message: string }

const ALLOWED = new Set(['label', 'descriptor', 'refImages', 'coverIndex', 'panels', 'sheetImage', 'status', 'stressResult'])

// Patch keys that carry the state's identity/content — editing any of these
// on a locked state breaks its "this sheet passed stress" promise.
const CONTENT_KEYS = new Set(['descriptor', 'refImages', 'coverIndex', 'panels', 'sheetImage'])

const STATUSES = new Set(['draft', 'testing', 'locked'])

export function applyStatePatch(record: CharacterRecord, body: StatePatchBody, now: string): StatePatchResult {
  const idx = record.states.findIndex(s => s.id === body.stateId)
  if (idx === -1) return { ok: false, code: 404, message: `No state '${body.stateId}'` }
  const state = record.states[idx]!

  if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== state.updatedAt) {
    return { ok: false, code: 409, message: 'State was modified since you last loaded it' }
  }

  const patch = body.patch ?? {}
  for (const key of Object.keys(patch)) {
    if (!ALLOWED.has(key)) return { ok: false, code: 400, message: `Unknown patch key '${key}'` }
  }
  if (patch.status !== undefined && !STATUSES.has(patch.status)) {
    return { ok: false, code: 400, message: `Invalid status '${patch.status}'` }
  }

  let next: CharacterState = { ...state, ...patch }

  // Content-edit rule: a locked state whose content the patch touches
  // demotes to draft (stressResult cleared) unless the same patch also
  // explicitly re-locks it — the lock rule below then re-validates that.
  const touchesContent = Object.keys(patch).some(k => CONTENT_KEYS.has(k))
  if (state.status === 'locked' && touchesContent && patch.status !== 'locked') {
    next = { ...next, status: 'draft', stressResult: null }
  }

  // Lock rule: locking requires a passing full stress result, from the
  // patch or already on the state. But if this same patch touches content,
  // the state.stressResult fallback is stale by definition (it validated
  // the OLD content) — a re-lock alongside a content edit must carry its
  // own fresh stressResult in the patch.
  if (next.status === 'locked') {
    const sr = touchesContent ? patch.stressResult : (patch.stressResult ?? state.stressResult)
    if (!sr || sr.passes !== sr.total || sr.total < 10) {
      return { ok: false, code: 400, message: 'Locking requires a passing full stress result (>=10/10)' }
    }
  }

  const healed = stateHygiene(next as unknown as Record<string, unknown>)
  if (!healed) return { ok: false, code: 400, message: 'Invalid state' }
  // Hygiene round-trip must not silently drop the caller's data (bad ref
  // filenames etc. surface as a 400 instead of a quiet write).
  if (healed.refImages.length !== next.refImages.length
    || healed.panels.length !== next.panels.length
    || (next.sheetImage !== null && healed.sheetImage === null)) {
    return { ok: false, code: 400, message: 'Invalid state' }
  }

  const newState: CharacterState = { ...healed, updatedAt: now }
  const states = record.states.slice()
  states[idx] = newState

  return { ok: true, record: { ...record, states, updatedAt: now } }
}
