import { describe, it, expect } from 'vitest'
import { injectSmartLayoutVars, substituteBoundTokens } from '~/lib/collection/injectVars'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { BINDINGS_PROP, COLLECTION_PROP } from '~/lib/collection/types'

// Minimal /object_info shape for the SmartLayout node: `layout` + `aspects`
// are positional widgets; the layer sockets are forced inputs (no slot).
const OBJECT_INFO = {
  SmartLayout: {
    input: {
      required: {
        layout: ['STRING', { multiline: true }],
        aspects: ['STRING', {}],
      },
      optional: {
        text_layer_1: ['STRING', { forceInput: true }],
        brand_kit: ['STRING', { multiline: true }],
      },
    },
  },
  Collection: { input: { required: {} } },
}

function layoutWithToken(content = '{{ props.text_layer_1 }}') {
  return JSON.stringify({
    version: 3,
    formats: { '1x1': { w: 1080, h: 1080 } },
    elements: [{ id: 'text_1', type: 'text', content }],
  })
}

function fixture() {
  const c = createCollection('Copy')
  addColumn(c, 'headline', 'text')
  const r1 = addRow(c)
  const r2 = addRow(c)
  setCell(c, r1.id, 'headline', 'A new kind of skincare is here.')
  setCell(c, r2.id, 'headline', 'Second row headline')

  const layoutNode = {
    id: 1,
    type: 'SmartLayout',
    mode: 0,
    widgets_values: [layoutWithToken(), '1x1'],
    properties: {
      [BINDINGS_PROP]: {
        'props.text_layer_1': { collectionId: c.id, columnKey: 'headline', lastLiteral: 'fallback copy' },
      },
    },
    inputs: [],
    outputs: [],
  }
  const collectionNode = {
    id: 2,
    type: 'Collection',
    mode: 0,
    widgets_values: [],
    properties: { [COLLECTION_PROP]: c },
    inputs: [],
    outputs: [],
  }
  const workflow = { nodes: [layoutNode, collectionNode], links: [] }
  return { c, workflow, layoutNode }
}

describe('substituteBoundTokens', () => {
  it('replaces only bound tokens, leaving unbound ones untouched', () => {
    const out = substituteBoundTokens(
      'X {{ props.text_layer_1 }} Y {{ props.text_layer_2 }} Z {{ brand.primary }}',
      { 'props.text_layer_1': 'Hello', 'brand.primary': '#fff' },
    )
    expect(out).toBe('X Hello Y {{ props.text_layer_2 }} Z #fff')
  })
})

describe('injectSmartLayoutVars', () => {
  it('bakes the preview row value into the layout widget', () => {
    const { workflow, layoutNode } = fixture()
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    const layout = JSON.parse(layoutNode.widgets_values[0] as string)
    expect(layout.elements[0].content).toBe('A new kind of skincare is here.')
  })

  it('respects the collection previewRow', () => {
    const { c, workflow, layoutNode } = fixture()
    c.previewRow = 1
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    const layout = JSON.parse(layoutNode.widgets_values[0] as string)
    expect(layout.elements[0].content).toBe('Second row headline')
  })

  it('falls back to lastLiteral when the bound collection node is gone', () => {
    const { workflow, layoutNode } = fixture()
    workflow.nodes = workflow.nodes.filter(n => n.type !== 'Collection')
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    const layout = JSON.parse(layoutNode.widgets_values[0] as string)
    expect(layout.elements[0].content).toBe('fallback copy')
  })

  it('substitutes tokens in section children too (v3 layouts)', () => {
    const { workflow, layoutNode } = fixture()
    const layout = JSON.parse(layoutNode.widgets_values[0] as string)
    layout.elements = []
    layout.sections = [{ id: 's1', children: [{ id: 'text_1', type: 'text', content: '{{ props.text_layer_1 }}' }] }]
    layoutNode.widgets_values[0] = JSON.stringify(layout)
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    const out = JSON.parse(layoutNode.widgets_values[0] as string)
    expect(out.sections[0].children[0].content).toBe('A new kind of skincare is here.')
  })

  it('leaves nodes without bindings byte-identical', () => {
    const { workflow, layoutNode } = fixture()
    delete (layoutNode.properties as any)[BINDINGS_PROP]
    const before = layoutNode.widgets_values[0]
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    expect(layoutNode.widgets_values[0]).toBe(before)
  })

  it('skips muted SmartLayout nodes', () => {
    const { workflow, layoutNode } = fixture()
    layoutNode.mode = 2
    const before = layoutNode.widgets_values[0]
    injectSmartLayoutVars(workflow, OBJECT_INFO)
    expect(layoutNode.widgets_values[0]).toBe(before)
  })

  it('survives malformed layout JSON without throwing', () => {
    const { workflow, layoutNode } = fixture()
    layoutNode.widgets_values[0] = '{not json'
    expect(() => injectSmartLayoutVars(workflow, OBJECT_INFO)).not.toThrow()
    expect(layoutNode.widgets_values[0]).toBe('{not json')
  })
})
