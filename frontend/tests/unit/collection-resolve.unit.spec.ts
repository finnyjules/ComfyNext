import { describe, it, expect } from 'vitest'
import { resolveBindings, splitRenderOverrides, validateRun } from '~/lib/collection/resolve'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import type { VarBindings } from '~/lib/collection/types'

function fixture() {
  const c = createCollection('Teams')
  addColumn(c, 'team', 'text')
  addColumn(c, 'primary', 'color')
  const r1 = addRow(c); const r2 = addRow(c)
  setCell(c, r1.id, 'team', 'France'); setCell(c, r1.id, 'primary', '#0C447C')
  setCell(c, r2.id, 'team', 'Brazil'); setCell(c, r2.id, 'primary', '#639922')
  const bindings: VarBindings = {
    'props.text_layer_1': { collectionId: c.id, columnKey: 'team', lastLiteral: 'Fallback' },
    'brand.primary': { collectionId: c.id, columnKey: 'primary', lastLiteral: '#ffffff' },
  }
  return { c, bindings }
}

describe('resolveBindings', () => {
  it('resolves row values by path', () => {
    const { c, bindings } = fixture()
    const out = resolveBindings(c, bindings, 1)
    expect(out.values['props.text_layer_1']).toBe('Brazil')
    expect(out.values['brand.primary']).toBe('#639922')
    expect(out.missing).toEqual([])
  })
  it('falls back to lastLiteral when the column is gone', () => {
    const { c, bindings } = fixture()
    c.columns = c.columns.filter(x => x.key !== 'team')
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBe('Fallback')
    expect(out.missing).toEqual(['props.text_layer_1'])
  })
  it('skips bindings for other collections', () => {
    const { c, bindings } = fixture()
    bindings['props.text_layer_1']!.collectionId = 'someone_else'
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBeUndefined()
  })
  it('empty cell falls back to lastLiteral', () => {
    const { c, bindings } = fixture()
    delete c.rows[0].values.team
    const out = resolveBindings(c, bindings, 0)
    expect(out.values['props.text_layer_1']).toBe('Fallback')
  })
})

describe('splitRenderOverrides', () => {
  it('splits props.* and brand.* namespaces', () => {
    const { props, brand } = splitRenderOverrides({
      'props.text_layer_1': 'France', 'brand.primary': '#0C447C',
    })
    expect(props).toEqual({ text_layer_1: 'France' })
    expect(brand).toEqual({ primary: '#0C447C' })
  })
})

describe('validateRun', () => {
  it('flags invalid hex in color-typed bound cells', () => {
    const { c, bindings } = fixture()
    setCell(c, c.rows[0].id, 'primary', 'not-a-color')
    const issues = validateRun(c, bindings)
    expect(issues).toHaveLength(1)
    expect(issues[0].rowIndex).toBe(0)
    expect(issues[0].path).toBe('brand.primary')
  })
  it('passes a clean table', () => {
    const { c, bindings } = fixture()
    expect(validateRun(c, bindings)).toEqual([])
  })
})
