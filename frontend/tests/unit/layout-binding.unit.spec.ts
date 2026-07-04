// frontend/tests/unit/layout-binding.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { promoteLayoutElement } from '~/lib/collection/layoutBinding'
import { COLLECTION_PROP, BINDINGS_PROP } from '~/lib/collection/types'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

function scene() {
  const c = createCollection('Vars')
  addColumn(c, 'existing', 'text')
  const r = addRow(c); setCell(c, r.id, 'existing', 'hello')
  const colNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
  const layout = { id: '2', data: { nodeType: 'SmartLayout', properties: {} } }
  const edges = [{ source: '1', sourceHandle: 'output-0', target: '2', targetHandle: 'input-3', data: { dataType: 'VARS' } }]
  return { c, colNode, layout, edges, nodes: [colNode, layout] }
}

describe('promoteLayoutElement', () => {
  it('reuses the wired collection: adds a typed column seeded with the current value and writes the props.* binding', () => {
    const { c, nodes, edges, layout } = scene()
    const res = promoteLayoutElement(
      () => nodes, () => edges, '2', 'text_layer_1', 'Headline', 'Hello world', 'text',
      () => { throw new Error('should reuse wired collection') },
    )
    expect(res?.columnKey).toBe('headline')
    expect(c.columns.find(x => x.key === 'headline')?.type).toBe('text')
    expect(c.rows[0]!.values.headline).toBe('Hello world')
    expect((layout.data.properties as any)[BINDINGS_PROP]['props.text_layer_1']).toMatchObject({
      columnKey: 'headline',
      lastLiteral: 'Hello world',
    })
  })

  it('image kind creates an image-typed column', () => {
    const { c, nodes, edges } = scene()
    const res = promoteLayoutElement(
      () => nodes, () => edges, '2', 'image_layer_1', 'Hero image', 'photo.png', 'image',
      () => { throw new Error('should reuse wired collection') },
    )
    expect(res?.columnKey).toBe('hero_image')
    expect(c.columns.find(x => x.key === 'hero_image')?.type).toBe('image')
    expect(c.rows[0]!.values.hero_image).toBe('photo.png')
  })

  it('creates a collection via the callback when none is wired yet', () => {
    const layout = { id: '2', data: { nodeType: 'SmartLayout', properties: {} } }
    const nodes = [layout]
    const edges: any[] = []
    let created: any = null
    const c = createCollection('Vars')
    const res = promoteLayoutElement(
      () => nodes, () => edges, '2', 'text_layer_1', 'Headline', 'Hi', 'text',
      () => {
        const colNode = { id: '9', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: c } } }
        nodes.push(colNode)
        created = colNode
        return colNode
      },
    )
    expect(created).not.toBeNull()
    expect(res?.columnKey).toBe('headline')
    expect(c.rows[0]!.values.headline).toBe('Hi')
  })

  it('clamps a stale out-of-range previewRow to the existing row instead of appending an orphan row', () => {
    const { c, nodes, edges } = scene()
    c.previewRow = 5 // stale — only 1 row exists
    const res = promoteLayoutElement(
      () => nodes, () => edges, '2', 'text_layer_1', 'Headline', 'Hello world', 'text',
      () => { throw new Error('should reuse wired collection') },
    )
    expect(res?.columnKey).toBe('headline')
    expect(c.rows.length).toBe(1)
    expect(c.previewRow).toBe(0)
    expect(c.rows[0]!.values.headline).toBe('Hello world')
  })

  it('returns null when the layout node cannot be found', () => {
    const { edges } = scene()
    const res = promoteLayoutElement(
      () => [], () => edges, 'missing', 'text_layer_1', 'Headline', 'Hi', 'text',
      () => { throw new Error('should not be called') },
    )
    expect(res).toBeNull()
  })
})
