import { describe, it, expect } from 'vitest'
import { tagTakeFromRunMeta, discardOthers, type Take } from '~/composables/useTakes'

const baseTake = (): Take => ({ id: 't1', createdAt: 1, promptId: 'p1', params: { seed: 5, model: 'flux-schnell' } })

describe('tagTakeFromRunMeta', () => {
  it('tags a draft take with draft:true and the restore snapshot', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', {
      draftMetaFor: () => ({ restore: { model: 'flux-pro' } }),
      consumePendingPromote: () => null,
    })
    expect(t.draft).toBe(true)
    expect(t.params?.draftRestore).toEqual({ model: 'flux-pro' })
  })

  it('tags a promoted take with promotedFrom and overrides params with what actually ran', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', {
      draftMetaFor: () => null,
      consumePendingPromote: () => ({ fromTakeId: 'take_d', overrides: { seed: 42, model: 'flux-pro' } }),
    })
    expect(t.promotedFrom).toBe('take_d')
    expect(t.draft).toBeUndefined()
    expect(t.params?.seed).toBe(42)      // the promoted run's real seed, not the live widget's
    expect(t.params?.model).toBe('flux-pro')
  })

  it('leaves a plain final take untouched', () => {
    const t = tagTakeFromRunMeta(baseTake(), '7', { draftMetaFor: () => null, consumePendingPromote: () => null })
    expect(t.draft).toBeUndefined()
    expect(t.promotedFrom).toBeUndefined()
  })
})

describe('discardOthers', () => {
  const t = (id: string, pinned = false): Take => ({ id, createdAt: 0, promptId: null, pinned })
  it('keeps the chosen take and every pinned take', () => {
    const out = discardOthers([t('a'), t('b', true), t('c')], 'c')
    expect(out.map(x => x.id)).toEqual(['b', 'c'])
  })
})
