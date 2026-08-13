import { describe, expect, it } from 'vitest'
import { applyStatePatch } from '~~/server/utils/characterStatePatch'
import { parseCharacterRecord } from '~~/server/utils/characterRegistry'

const rec = () => parseCharacterRecord(JSON.stringify({
  name: 'Cal',
  states: [{ id: 'default', label: 'Default', descriptor: '', refImages: ['a.png'], coverIndex: 0, panels: [], sheetImage: null, status: 'draft', stressResult: null, updatedAt: 'T1' }],
}), 'cal')!

it('patches named fields and stamps updatedAt', () => {
  const r = applyStatePatch(rec(), { stateId: 'default', patch: { descriptor: 'wet hair' } }, 'T2')
  expect(r.ok && r.record.states[0]!.descriptor).toBe('wet hair')
  expect(r.ok && r.record.states[0]!.updatedAt).toBe('T2')
})
it('404 on unknown state', () => {
  expect(applyStatePatch(rec(), { stateId: 'gone', patch: {} }, 'T2')).toMatchObject({ ok: false, code: 404 })
})
it('409 when expectedUpdatedAt is stale', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', expectedUpdatedAt: 'T0', patch: { label: 'X' } }, 'T2'))
    .toMatchObject({ ok: false, code: 409 })
})
it('matching expectedUpdatedAt writes', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', expectedUpdatedAt: 'T1', patch: { label: 'X' } }, 'T2'))
    .toMatchObject({ ok: true })
})
it('400 on bad filenames / unknown patch keys / bad status', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { refImages: ['../evil'] } }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { nope: 1 } as never }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { status: 'gold' as never } }, 'T2')).toMatchObject({ ok: false, code: 400 })
})
it('locking requires a passing full stress result (in patch or already on state)', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { status: 'locked' } }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), {
    stateId: 'default',
    patch: { status: 'locked', stressResult: { passes: 10, total: 10, at: 'T2' } },
  }, 'T2')).toMatchObject({ ok: true })
  expect(applyStatePatch(rec(), {
    stateId: 'default',
    patch: { status: 'locked', stressResult: { passes: 9, total: 10, at: 'T2' } },
  }, 'T2')).toMatchObject({ ok: false, code: 400 })
})
it('content edits on a locked state revert it to draft and clear stressResult', () => {
  const locked = rec()
  locked.states[0]! = { ...locked.states[0]!, status: 'locked', stressResult: { passes: 10, total: 10, at: 'T1' } }
  const r = applyStatePatch(locked, { stateId: 'default', patch: { descriptor: 'new coat' } }, 'T2')
  expect(r.ok && r.record.states[0]!.status).toBe('draft')
  expect(r.ok && r.record.states[0]!.stressResult).toBe(null)
})
