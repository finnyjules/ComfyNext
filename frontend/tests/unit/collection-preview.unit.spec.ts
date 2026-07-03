import { describe, it, expect } from 'vitest'
import { wiredTargets, pushVarPreview } from '~/lib/collection/preview'
import { COLLECTION_PROP, BINDINGS_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Teams')
  addColumn(c, 'team', 'text'); addColumn(c, 'primary', 'color')
  const r = addRow(c)
  setCell(c, r.id, 'team', 'France'); setCell(c, r.id, 'primary', '#0C447C')
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const slNode = { id: '2', data: { nodeType: 'SmartLayout', properties: {
    [BINDINGS_PROP]: {
      'props.text_layer_1': { collectionId: c.id, columnKey: 'team' },
      'brand.primary': { collectionId: c.id, columnKey: 'primary' },
    },
  } } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-9', data: { dataType: 'VARS' } }]
  return { colNode, slNode, edges }
}

describe('wiredTargets', () => {
  it('finds nodes wired from output-0', () => {
    const { colNode, slNode, edges } = scene()
    expect(wiredTargets('1', [colNode, slNode], edges).map(n => n.id)).toEqual(['2'])
  })
})

describe('pushVarPreview', () => {
  it('writes resolved props/brand for the preview row onto the target', () => {
    const { colNode, slNode, edges } = scene()
    pushVarPreview(colNode, wiredTargets('1', [colNode, slNode], edges))
    const p = (slNode.data.properties as any)[VAR_PREVIEW_PROP]
    expect(p.props).toEqual({ text_layer_1: 'France' })
    expect(p.brand).toEqual({ primary: '#0C447C' })
  })
})
