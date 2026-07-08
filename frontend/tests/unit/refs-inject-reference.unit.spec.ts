import { describe, it, expect } from 'vitest'
import { materializeReferenceNodes } from '../../app/lib/refs/injectWorkflow'
import { setRef } from '../../app/lib/refs/registry'

const reg = setRef({}, 'tracksuit', { filename: 'suit.png' })

describe('materializeReferenceNodes', () => {
  it('rewrites a Reference node into an Image node with the resolved filename + full default widgets', () => {
    const wf = { nodes: [{ id: 7, type: 'Reference', properties: { comfynext_refName: 'tracksuit' }, widgets_values: [] }] }
    materializeReferenceNodes(wf, reg)
    const n = wf.nodes[0] as any
    expect(n.type).toBe('Image')
    expect(n.widgets_values).toEqual(['suit.png', false, 'ComfyUI', 'png', 90, false, 4, 1.0, 0, true, -1])
  })
  it('leaves a Reference node with an unresolved ref untouched (so it gets stripped, not mis-wired)', () => {
    const wf = { nodes: [{ id: 8, type: 'Reference', properties: { comfynext_refName: 'ghost' }, widgets_values: [] }] }
    materializeReferenceNodes(wf, reg)
    expect((wf.nodes[0] as any).type).toBe('Reference')
  })
  it('tolerates a missing/empty nodes array', () => {
    expect(() => materializeReferenceNodes({}, reg)).not.toThrow()
    expect(() => materializeReferenceNodes({ nodes: [] }, reg)).not.toThrow()
  })
})
