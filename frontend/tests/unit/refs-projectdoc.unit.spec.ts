import { describe, it, expect } from 'vitest'
import { toProjectDoc } from '../../app/lib/projectDoc'

describe('ProjectDoc.assetRegistry round-trip', () => {
  it('preserves an existing assetRegistry through toProjectDoc', () => {
    const doc = {
      canvases: [{ id: 'c1', name: 'Shot 1', workflow: { nodes: [] } }],
      activeCanvasId: 'c1',
      assetRegistry: { tracksuit: { filename: 'suit.png', text: 'black Nike tracksuit' } },
    }
    const out = toProjectDoc(doc as any)
    expect(out.assetRegistry).toEqual({ tracksuit: { filename: 'suit.png', text: 'black Nike tracksuit' } })
  })
  it('defaults assetRegistry to an empty object when absent', () => {
    const out = toProjectDoc({ nodes: [] } as any)
    expect(out.assetRegistry).toEqual({})
  })
})
