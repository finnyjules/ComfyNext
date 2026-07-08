import { describe, it, expect } from 'vitest'
import { promoteOverridesFor, applyPendingPromotes } from '~/lib/draft/promote'
import type { Take } from '~/composables/useTakes'

const draftTake = (params: Record<string, any>): Take =>
  ({ id: 'td', createdAt: 0, promptId: 'p', draft: true, params })

describe('promoteOverridesFor', () => {
  it('builds overrides from draftRestore + snapshot seed/prompt/aspect', () => {
    expect(promoteOverridesFor(draftTake({
      draftRestore: { model: 'flux-pro', model_options: '{"guidance":3}' },
      seed: 42, prompt: 'a cat', aspect_ratio: '1:1',
    }))).toEqual({ model: 'flux-pro', model_options: '{"guidance":3}', seed: 42, prompt: 'a cat', aspect_ratio: '1:1' })
  })
  it('returns null for a non-draft take', () => {
    expect(promoteOverridesFor({ id: 't', createdAt: 0, promptId: null, params: { seed: 1 } })).toBeNull()
  })
})

describe('applyPendingPromotes', () => {
  it('substitutes widgets for a pending node and reports it', () => {
    const wf = { nodes: [{ id: 5, type: 'GenerateImageNode', widgets_values: ['flux-schnell', 'a cat', '1:1', 999, '{}'] }] }
    const vnodes = [{ id: '5', data: { nodeType: 'GenerateImageNode', widgetDefs: [{ name: 'model' }, { name: 'prompt' }, { name: 'aspect_ratio' }, { name: 'seed' }, { name: 'model_options' }] } }]
    const consume = (id: string) => id === '5' ? { fromTakeId: 'td', overrides: { model: 'flux-pro', seed: 42 } } : null
    const ids = applyPendingPromotes(wf, vnodes, consume)
    expect(ids).toEqual(['5'])
    expect(wf.nodes[0].widgets_values[0]).toBe('flux-pro')
    expect(wf.nodes[0].widgets_values[3]).toBe(42)
    expect(wf.nodes[0].widgets_values[1]).toBe('a cat')
  })
})
