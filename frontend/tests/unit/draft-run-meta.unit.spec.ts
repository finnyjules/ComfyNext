import { describe, it, expect, beforeEach } from 'vitest'
import { markDraftRun, clearDraftRun, draftMetaFor, setPendingPromote, consumePendingPromote, peekPendingPromote } from '~/lib/draft/runMeta'

describe('draft run meta', () => {
  beforeEach(() => { clearDraftRun(['1', '2', '9']); consumePendingPromote('1') })

  it('marks and reads draft meta per node; final submit clears it', () => {
    markDraftRun(['1', '2'], { '1': { model: 'flux-pro' }, '2': { num_inference_steps: 28 } })
    expect(draftMetaFor('1')).toEqual({ restore: { model: 'flux-pro' } })
    expect(draftMetaFor('2')).toEqual({ restore: { num_inference_steps: 28 } })
    expect(draftMetaFor('9')).toBeNull()
    clearDraftRun(['1'])
    expect(draftMetaFor('1')).toBeNull()
    expect(draftMetaFor('2')).not.toBeNull()
  })

  it('pending promote is one-shot', () => {
    setPendingPromote('1', { fromTakeId: 'take_a', overrides: { seed: 7, model: 'flux-pro' } })
    expect(consumePendingPromote('1')).toEqual({ fromTakeId: 'take_a', overrides: { seed: 7, model: 'flux-pro' } })
    expect(consumePendingPromote('1')).toBeNull()
  })

  it('peek does not clear pending promote, consume does', () => {
    setPendingPromote('1', { fromTakeId: 'take_b', overrides: { seed: 42 } })
    expect(peekPendingPromote('1')).toEqual({ fromTakeId: 'take_b', overrides: { seed: 42 } })
    expect(peekPendingPromote('1')).toEqual({ fromTakeId: 'take_b', overrides: { seed: 42 } })
    expect(consumePendingPromote('1')).toEqual({ fromTakeId: 'take_b', overrides: { seed: 42 } })
    expect(consumePendingPromote('1')).toBeNull()
    expect(peekPendingPromote('1')).toBeNull()
  })
})
