import { describe, it, expect } from 'vitest'
import { sketchPromoteOverridesFor, sketchPromoteOverridesFromProps } from '~/lib/draft/sketchPromote'
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

describe('sketchPromoteOverridesFromProps', () => {
  it('builds overrides from card-local provenance and locks the seed', () => {
    const o = sketchPromoteOverridesFromProps({ sketchPrompt: 'a red door', sketchSeed: 7 })
    expect(o?.widgetOverrides.prompt).toBe('a red door')
    expect(o?.widgetOverrides.seed).toBe(7)
    expect(o?.widgetOverrides.model).toBeUndefined()
    expect(o?.propertyOverrides.seedLocks).toEqual({ seed: true })
  })
  it('returns null with no prompt', () => {
    expect(sketchPromoteOverridesFromProps({})).toBeNull()
  })
})
