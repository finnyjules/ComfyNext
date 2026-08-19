import { describe, it, expect } from 'vitest'
import { applyCompositorCommand, describeCompositor } from '~/lib/agent/surfaces/compositor'
import type { CompositorState } from '~/lib/agent/surfaces/compositor'

const baseState = (): CompositorState => ({
  layers: [{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.4, h: 0.3, fill: '#fff', stroke: '', strokeWidth: 0, radius: 0 } as any],
})

describe('setLayerFeather', () => {
  it('sets a feather with clamped amount and defaults', () => {
    const r = applyCompositorCommand(baseState(), {
      op: 'setLayerFeather', target: 'a', args: { patch: { amount: 99, curve: 'smooth' } },
    })
    expect(r.ok).toBe(true)
    const layer = (r as any).template.layers[0]
    expect(layer.feather.amount).toBe(1)     // clamped
    expect(layer.feather.curve).toBe('smooth')
  })

  it('merges a partial patch over an existing feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerFeather', target: 'a', args: { patch: { curve: 'linear' } } }) as any).template
    expect(s2.layers[0].feather.amount).toBe(0.2)
    expect(s2.layers[0].feather.curve).toBe('linear')
  })

  it('remove:true clears the feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    const s2 = (applyCompositorCommand(s1, { op: 'setLayerFeather', target: 'a', args: { remove: true } }) as any).template
    expect(s2.layers[0].feather).toBeUndefined()
  })

  it('errors on an unknown layer', () => {
    const r = applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'nope', args: { patch: {} } })
    expect(r.ok).toBe(false)
  })

  it('describeCompositor reports an active feather', () => {
    const s1 = (applyCompositorCommand(baseState(), { op: 'setLayerFeather', target: 'a', args: { patch: { amount: 0.2 } } }) as any).template
    const snap = describeCompositor(s1)
    expect(JSON.stringify(snap)).toContain('feather')
  })
})
