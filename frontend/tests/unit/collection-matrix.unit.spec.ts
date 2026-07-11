import { describe, expect, it } from 'vitest'
import { planMatrix, columnPool, comboFilename, buildBatchPayload, type MatrixPool } from '~/lib/collection/matrix'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

const P = (key: string, label: string, kind: 'format' | 'text' | 'image', vals: string[]): MatrixPool =>
  ({ key, label, kind, values: vals.map(v => ({ value: v, label: v })) })

describe('planMatrix', () => {
  it('produces the full cartesian product in pool order (3×3×3 = 27)', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16', '16x9']),
      P('props.text_layer_1', 'Tagline', 'text', ['a', 'b', 'c']),
      P('props.image_layer_1', 'Image', 'image', ['u1', 'u2', 'u3']),
    ])
    expect(combos).toHaveLength(27)
    expect(combos[0]).toMatchObject({ format: '1x1', values: { 'props.text_layer_1': 'a', 'props.image_layer_1': 'u1' } })
    // format varies slowest, last pool fastest
    expect(combos[1]!.values['props.image_layer_1']).toBe('u2')
    expect(combos[26]).toMatchObject({ format: '16x9', values: { 'props.text_layer_1': 'c', 'props.image_layer_1': 'u3' } })
  })

  it('single-value pools collapse (3×1 = 3) and labels carry through', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16', '16x9']),
      P('props.text_layer_1', 'Tagline', 'text', ['hello']),
    ])
    expect(combos).toHaveLength(3)
    expect(combos[0]!.labels).toEqual({ format: '1x1', 'props.text_layer_1': 'hello' })
  })

  it('defensively skips an empty pool instead of zeroing everything', () => {
    const combos = planMatrix([
      P('format', 'Format', 'format', ['1x1', '9x16']),
      P('props.text_layer_1', 'Tagline', 'text', []),
    ])
    expect(combos).toHaveLength(2)
  })

  it('formats-only batch works (no variable pools)', () => {
    expect(planMatrix([P('format', 'Format', 'format', ['1x1'])])).toHaveLength(1)
  })
})

describe('columnPool', () => {
  it('returns distinct, non-empty values in row order', () => {
    const c = createCollection('T')
    addColumn(c, 'tag', 'text')
    const r1 = addRow(c); const r2 = addRow(c); const r3 = addRow(c); const r4 = addRow(c)
    setCell(c, r1.id, 'tag', 'b')
    setCell(c, r2.id, 'tag', 'a')
    setCell(c, r3.id, 'tag', 'b')     // duplicate
    setCell(c, r4.id, 'tag', '  ')    // blank
    expect(columnPool(c, 'tag')).toEqual([
      { value: 'b', label: 'b' },
      { value: 'a', label: 'a' },
    ])
  })
  it('unknown column → empty pool', () => {
    expect(columnPool(createCollection('T'), 'nope')).toEqual([])
  })
})

describe('comboFilename', () => {
  const combo = { format: '9x16', values: {}, labels: { 'format': '9x16', 'props.text_layer_1': 'Fresh Skin!', 'props.image_layer_1': 'Bottle 2' } }
  it('sanitizes and joins label parts with the index suffix', () => {
    expect(comboFilename('Summer Launch', combo as any, 4)).toBe('summer-launch_9x16_fresh-skin_bottle-2_5.png')
  })
})

describe('buildBatchPayload', () => {
  const pools = [
    P('format', 'Format', 'format', ['1x1', '9x16']),
    P('props.text_layer_1', 'Tagline', 'text', ['a', 'b']),
  ]
  it('keeps only combos with a rendered url and maps labels → vars', () => {
    const combos = planMatrix(pools)
    const urls = [undefined, '/view?a', '/view?b', undefined]
    const p = buildBatchPayload('123', 'My Layout', pools, combos, urls, '2026-07-11T00:00:00Z')
    expect(p.items).toHaveLength(2)
    expect(p.items[0]).toMatchObject({
      url: '/view?a', format: '1x1', formatLabel: '1x1',
      vars: { Tagline: 'b' },
    })
    expect(p.sourceNodeId).toBe('123')
    expect(p.createdAt).toBe('2026-07-11T00:00:00Z')
  })
})
