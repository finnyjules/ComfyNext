import { describe, it, expect } from 'vitest'
import {
  listSmartLayoutBindables, readTemplateFromNode, autoAlign, typeCompatible,
} from '~/lib/collection/bindables'
import type { CollectionColumn } from '~/lib/collection/types'

const TEMPLATE = {
  version: 3,
  sections: [{
    id: 's1', name: 'main', region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 },
    children: [
      { id: 'e1', type: 'text', content: 'Hello {{ props.text_layer_1 }}' },
      { id: 'e2', type: 'image', content: '{{ props.image_layer_1 }}' },
      { id: 'e3', type: 'text', content: 'static' },
    ],
  }],
}

describe('listSmartLayoutBindables', () => {
  it('finds props sockets with types and includes brand keys', () => {
    const b = listSmartLayoutBindables(TEMPLATE)
    const paths = b.map(x => x.path)
    expect(paths).toContain('props.text_layer_1')
    expect(paths).toContain('props.image_layer_1')
    expect(paths).toContain('brand.primary')
    expect(b.find(x => x.path === 'props.image_layer_1')?.type).toBe('image')
    expect(b.find(x => x.path === 'brand.primary')?.type).toBe('color')
    expect(b.find(x => x.path === 'brand.fontDisplay')?.type).toBe('font')
  })
  it('dedupes repeated sockets', () => {
    const t = { sections: [{ children: [
      { type: 'text', content: '{{ props.text_layer_1 }} and {{ props.text_layer_1 }}' },
    ] }] }
    const b = listSmartLayoutBindables(t)
    expect(b.filter(x => x.path === 'props.text_layer_1')).toHaveLength(1)
  })
})

describe('readTemplateFromNode', () => {
  it('parses the layout widget JSON', () => {
    const node = { data: {
      widgetDefs: [{ name: 'other' }, { name: 'layout' }],
      widgetsValues: ['x', JSON.stringify(TEMPLATE)],
    } }
    expect((readTemplateFromNode(node) as any)?.version).toBe(3)
  })
  it('returns null on missing/invalid layout', () => {
    expect(readTemplateFromNode({ data: { widgetDefs: [], widgetsValues: [] } })).toBeNull()
  })
})

describe('autoAlign', () => {
  const cols: CollectionColumn[] = [
    { key: 'text_layer_1', label: 'Headline', type: 'text' },
    { key: 'primary', label: 'Primary', type: 'color' },
    { key: 'crest', label: 'Crest', type: 'image' },
  ]
  it('binds exact key matches when types are compatible', () => {
    const b = autoAlign(listSmartLayoutBindables(TEMPLATE), cols, 'col_1')
    expect(b['props.text_layer_1']?.columnKey).toBe('text_layer_1')
    expect(b['brand.primary']?.columnKey).toBe('primary')
    expect(b['props.image_layer_1']).toBeUndefined()
  })
  it('rejects type-incompatible matches', () => {
    const b = autoAlign(
      [{ path: 'brand.primary', label: 'primary', type: 'color' }],
      [{ key: 'primary', label: 'p', type: 'text' }],
      'col_1',
    )
    expect(b['brand.primary']).toBeUndefined()
  })
})

describe('typeCompatible', () => {
  it('text accepts numbers, color needs color, image accepts text urls', () => {
    expect(typeCompatible('text', 'number')).toBe(true)
    expect(typeCompatible('color', 'text')).toBe(false)
    expect(typeCompatible('image', 'text')).toBe(true)
  })
})
