import { describe, it, expect } from 'vitest'
import { toProjectDoc, isProjectDoc } from '../../app/lib/projectDoc'

describe('ProjectDoc.brandKitId', () => {
  it('survives toProjectDoc pass-through for existing docs', () => {
    const doc = toProjectDoc({ canvases: [{ id: 'c1', name: 'Canvas 1', workflow: {} }], activeCanvasId: 'c1', brandKitId: 'liv-golf-2025' })
    expect(isProjectDoc(doc)).toBe(true)
    expect((doc as any).brandKitId).toBe('liv-golf-2025')
  })
  it('legacy bare workflows wrap without a brandKitId', () => {
    const doc = toProjectDoc({ nodes: [], links: [] })
    expect((doc as any).brandKitId).toBeUndefined()
  })
})
