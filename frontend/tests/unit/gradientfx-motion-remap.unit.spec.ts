import { describe, it, expect } from 'vitest'
import { remapTracksOnReorder, dropTracksForLayer } from '~/lib/gradientfx/motion'

const mk = (layer: number) => ({ layer, param: 'phase', from: 0, to: 1, easing: 'linear' as const, loops: 1, hold: 0, cycleOffset: 0, delay: 0 })

describe('gradient motion track remap', () => {
  it('follows a layer moved from 2 to 0', () => {
    const t = [mk(2)]
    remapTracksOnReorder(t, 2, 0)
    expect(t[0]!.layer).toBe(0)
  })
  it('shifts intermediate layers when reordering', () => {
    const t = [mk(0), mk(1)]
    remapTracksOnReorder(t, 0, 1) // layer 0 moves to slot 1; old layer 1 shifts to 0
    expect(t.map(x => x.layer)).toEqual([1, 0])
  })
  it('drops tracks for a removed layer and renumbers higher ones', () => {
    const t = [mk(0), mk(1), mk(2)]
    const kept = dropTracksForLayer(t, 1)
    expect(kept.map(x => x.layer)).toEqual([0, 1]) // layer 2 became 1
  })
})
