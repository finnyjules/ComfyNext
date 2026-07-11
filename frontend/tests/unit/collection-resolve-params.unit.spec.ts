import { describe, it, expect } from 'vitest'
import { splitResolvedValues } from '~/lib/collection/resolve'
import { pushVarPreview, wiredTargets } from '~/lib/collection/preview'
import { COLLECTION_PROP, BINDINGS_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

describe('splitResolvedValues', () => {
  it('splits props, brand, and params namespaces; params keep number types', () => {
    const out = splitResolvedValues({
      'props.text_layer_1': 'France',
      'brand.primary': '#0C447C',
      'params.flow.intensity': 42,
      'params.scale': 1.5,
    })
    expect(out.props).toEqual({ text_layer_1: 'France' })
    expect(out.brand).toEqual({ primary: '#0C447C' })
    expect(out.params).toEqual({ 'flow.intensity': 42, 'scale': 1.5 })
  })
  it('dotted control keys survive (only the first segment is the namespace)', () => {
    const out = splitResolvedValues({ 'params.layer.color.stops.0.color': '#fff' })
    expect(out.params).toEqual({ 'layer.color.stops.0.color': '#fff' })
  })
})

describe('pushVarPreview with params bindings', () => {
  it('writes params into sailor_varPreview on a studio target', () => {
    const c = createCollection('Sweeps')
    addColumn(c, 'intensity', 'number')
    const r = addRow(c)
    setCell(c, r.id, 'intensity', 42)
    const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
    const studio = { id: '2', data: { nodeType: 'GradientStudio', properties: {
      [BINDINGS_PROP]: { 'params.flow.intensity': { collectionId: c.id, columnKey: 'intensity' } },
    } } }
    const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
    pushVarPreview(colNode, wiredTargets('1', [colNode, studio], edges))
    const p = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(p.params).toEqual({ 'flow.intensity': 42 })
  })
})
