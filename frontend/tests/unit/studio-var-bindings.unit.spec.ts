// frontend/tests/unit/studio-var-bindings.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyParamsPreview, writeThroughEdit, promoteControl } from '~/composables/useStudioVarBindings'
import { COLLECTION_PROP, BINDINGS_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Vars')
  addColumn(c, 'intensity', 'number')
  const r = addRow(c); setCell(c, r.id, 'intensity', 42)
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const studio = { id: '2', data: { nodeType: 'GradientStudio', properties: {
    [BINDINGS_PROP]: { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } },
  } } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
  return { c, colNode, studio, edges, nodes: [colNode, studio] }
}

describe('applyParamsPreview', () => {
  it('applies clamped values for known controls only', () => {
    const applied: Record<string, unknown> = {}
    const keys = applyParamsPreview(
      { params: { 'flow.intensity': 250, 'unknown.key': 1 } },
      [{ key: 'flow.intensity', label: 'I', kind: 'slider', min: 0, max: 100 }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({ 'flow.intensity': 100 })
    expect(keys).toEqual(['flow.intensity'])
  })
  it('skips invalid color values', () => {
    const applied: Record<string, unknown> = {}
    applyParamsPreview(
      { params: { 'bg': 'not-a-hex' } },
      [{ key: 'bg', label: 'B', kind: 'color' }],
      (k, v) => { applied[k] = v },
    )
    expect(applied).toEqual({})
  })
})

describe('writeThroughEdit', () => {
  it('writes a bound control edit into the collection preview-row cell', () => {
    const { c, nodes, edges } = scene()
    const ok = writeThroughEdit(() => nodes, () => edges, '2', 'params.flow.intensity', 77)
    expect(ok).toBe(true)
    expect(c.rows[0]!.values.intensity).toBe(77)
  })
  it('returns false for unbound paths', () => {
    const { nodes, edges } = scene()
    expect(writeThroughEdit(() => nodes, () => edges, '2', 'params.nope', 1)).toBe(false)
  })
})

describe('promoteControl', () => {
  it('adds a typed column seeded with the current value and writes the binding', () => {
    const { c, nodes, edges, studio } = scene()
    const res = promoteControl(() => nodes, () => edges, '2',
      { key: 'canvas.background', label: 'Background', kind: 'color' }, '#112233', () => { throw new Error('should reuse wired collection') })
    expect(res?.columnKey).toBe('background')
    expect(c.columns.find(x => x.key === 'background')?.type).toBe('color')
    expect(c.rows[0]!.values.background).toBe('#112233')
    expect((studio.data.properties as any)[BINDINGS_PROP]['params.canvas.background']).toMatchObject({ columnKey: 'background', lastLiteral: '#112233' })
  })
})
