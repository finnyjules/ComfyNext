import { describe, it, expect } from 'vitest'
import { diffTakeParams } from '~/lib/artifact/takeDiff'
import type { Take } from '~/composables/useTakes'

const take = (params: Record<string, any>): Take => ({ id: 'x', createdAt: 0, promptId: null, params })

describe('diffTakeParams', () => {
  it('lists only differing keys, covering keys present on either side', () => {
    const rows = diffTakeParams(
      take({ seed: 1, prompt: 'a cat', model: 'flux-pro' }),
      take({ seed: 2, prompt: 'a cat', aspect_ratio: '1:1' }),
    )
    expect(rows).toEqual([
      { key: 'seed', a: 1, b: 2 },
      { key: 'model', a: 'flux-pro', b: undefined },
      { key: 'aspect_ratio', a: undefined, b: '1:1' },
    ])
  })
  it('excludes internal bookkeeping keys and returns [] for identical params', () => {
    expect(diffTakeParams(take({ seed: 1, draftRestore: { x: 1 }, nodeType: 'G' }), take({ seed: 1 }))).toEqual([])
  })
})
