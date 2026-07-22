import { describe, it, expect } from 'vitest'
import { sketchPromoteOverridesFor } from '~/lib/draft/sketchPromote'
import type { Take } from '~/composables/useTakes'

const take = (params: Record<string, any>): Take => ({ id: 't', createdAt: 0, promptId: null, params })

describe('sketchPromoteOverridesFor', () => {
  it('copies prompt/seed/aspect, locks the seed, never copies model', () => {
    const r = sketchPromoteOverridesFor(take({ prompt: 'a cat', seed: 42, aspect_ratio: '1:1', model: 'flux-schnell' }))
    expect(r!.widgetOverrides).toEqual({ prompt: 'a cat', seed: 42, aspect_ratio: '1:1' })
    expect(r!.propertyOverrides).toEqual({ seedLocks: { seed: true } })
  })
  it('omits seed lock when no seed; null when nothing usable', () => {
    expect(sketchPromoteOverridesFor(take({ prompt: 'x' }))!.propertyOverrides).toEqual({})
    expect(sketchPromoteOverridesFor(take({ model: 'flux-schnell' }))).toBeNull()
  })
})
