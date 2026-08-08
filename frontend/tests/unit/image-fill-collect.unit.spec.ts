import { describe, it, expect } from 'vitest'
import { collectFillImageSrcs } from '~/composables/useCompositorLayers'
import type { LocalLayer } from '~/composables/useCompositorLayers'

const rect = (over: any): LocalLayer => ({
  id: 'r', kind: 'rect', x: 0, y: 0, w: 0.3, h: 0.2, rotation: 0, opacity: 1,
  fill: '#fff', stroke: '', strokeWidth: 0, radius: 0, ...over,
}) as any

describe('collectFillImageSrcs', () => {
  it('collects image-fill srcs from fill and stroke, de-duplicated', () => {
    const a = { type: 'image', src: 'A', fit: 'cover' }
    const b = { type: 'image', src: 'B', fit: 'tile' }
    const layers = [
      rect({ fill: a }),
      rect({ id: 'r2', fill: '#000', stroke: b }),
      rect({ id: 'r3', fill: a }),           // dup of A
    ]
    expect(collectFillImageSrcs(layers).sort()).toEqual(['A', 'B'])
  })

  it('ignores solid / gradient / pattern fills', () => {
    expect(collectFillImageSrcs([rect({ fill: '#123' })])).toEqual([])
  })
})
