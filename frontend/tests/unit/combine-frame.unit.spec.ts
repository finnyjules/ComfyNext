import { describe, it, expect } from 'vitest'
import { planFrameFromSelection, MAX_FRAME_LAYERS, type SelectionNode } from '../../app/lib/canvas/combineFrame'

// Helper: an image node at (x, y) with an IMAGE output at the given slot index.
function imgNode(id: string, x: number, y: number, opts: { imageSlot?: number; width?: number } = {}): SelectionNode {
  const slot = opts.imageSlot ?? 0
  const outputs = Array.from({ length: slot + 1 }, (_, i) => ({ type: i === slot ? 'IMAGE' : 'MASK' }))
  return { id, position: { x, y }, data: { outputs, size: [opts.width ?? 240, 240] } }
}

describe('planFrameFromSelection', () => {
  it('keeps only nodes with an IMAGE output', () => {
    const sel: SelectionNode[] = [
      imgNode('a', 0, 0),
      { id: 'text', position: { x: 100, y: 0 }, data: { outputs: [{ type: 'STRING' }] } },
      imgNode('b', 300, 0),
      { id: 'noOut', position: { x: 400, y: 0 }, data: { outputs: [] } },
    ]
    const plan = planFrameFromSelection(sel)
    expect(plan.layers.map((l) => l.id)).toEqual(['a', 'b'])
    expect(plan.canCombine).toBe(true)
  })

  it('orders layers top-to-bottom then left-to-right (layer1 = top-left)', () => {
    // Deliberately shuffled input order.
    const sel = [
      imgNode('bottomRight', 300, 300),
      imgNode('topRight', 300, 0),
      imgNode('topLeft', 0, 0),
      imgNode('bottomLeft', 0, 300),
    ]
    const plan = planFrameFromSelection(sel)
    expect(plan.layers.map((l) => l.id)).toEqual(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'])
  })

  it('captures the IMAGE output slot index (not assuming slot 0)', () => {
    const sel = [imgNode('a', 0, 0, { imageSlot: 2 }), imgNode('b', 100, 0, { imageSlot: 0 })]
    const plan = planFrameFromSelection(sel)
    expect(plan.layers).toEqual([
      { id: 'a', outputIndex: 2 },
      { id: 'b', outputIndex: 0 },
    ])
  })

  it('caps at MAX_FRAME_LAYERS and reports the number skipped', () => {
    const sel = Array.from({ length: MAX_FRAME_LAYERS + 3 }, (_, i) => imgNode(`n${i}`, i * 10, 0))
    const plan = planFrameFromSelection(sel)
    expect(plan.layers).toHaveLength(MAX_FRAME_LAYERS)
    expect(plan.skipped).toBe(3)
  })

  it('cannot combine fewer than 2 image nodes', () => {
    expect(planFrameFromSelection([imgNode('only', 0, 0)]).canCombine).toBe(false)
    expect(planFrameFromSelection([]).canCombine).toBe(false)
  })

  it('places the Frame to the right of the selection bounding box', () => {
    // Rightmost node starts at x=300 with width 240 → right edge 540; gap 120 → 660.
    const sel = [imgNode('a', 0, 50), imgNode('b', 300, 200, { width: 240 })]
    const plan = planFrameFromSelection(sel)
    expect(plan.position).toEqual({ x: 660, y: 50 })
  })
})
