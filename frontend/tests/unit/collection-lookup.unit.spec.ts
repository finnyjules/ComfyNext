import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { linkedColumns, effectiveColumns, findLinkedColumn } from '~/lib/collection/lookup'
import type { LookupResolver } from '~/lib/collection/lookup'

function players() {
  const c = createCollection('Players')
  addColumn(c, 'Name', 'text')
  addColumn(c, 'Country', 'text')
  const r = addRow(c); setCell(c, r.id, 'name', 'Mbappe'); setCell(c, r.id, 'country', 'France')
  return c
}
function themes() {
  const t = createCollection('Themes')
  addColumn(t, 'Country', 'text')
  addColumn(t, 'Fill1', 'color')
  addColumn(t, 'Text', 'color')
  const r = addRow(t); setCell(t, r.id, 'country', 'France'); setCell(t, r.id, 'fill1', '#0000ff'); setCell(t, r.id, 'text', '#ffffff')
  return t
}
function scene() {
  const local = players(); const foreign = themes()
  local.links = [{ collectionId: foreign.id, matchLocal: 'country', matchForeign: 'country' }]
  const resolve: LookupResolver = id => (id === foreign.id ? foreign : undefined)
  return { local, foreign, resolve }
}

describe('linkedColumns', () => {
  it('contributes foreign non-key columns as namespaced linked columns', () => {
    const { local, foreign, resolve } = scene()
    const cols = linkedColumns(local, resolve)
    expect(cols.map(c => c.sourceColumnKey)).toEqual(['fill1', 'text']) // 'country' (matchForeign) excluded
    expect(cols[0]!.key).toBe(`${foreign.id}::fill1`)
    expect(cols[0]!.label).toBe('Fill1')
    expect(cols[0]!.type).toBe('color')
    expect(cols[0]!.matchLocal).toBe('country')
  })
  it('is empty when the foreign collection cannot be resolved', () => {
    const { local } = scene()
    expect(linkedColumns(local, () => undefined)).toEqual([])
  })
  it('namespaces the label when it collides with an existing effective label', () => {
    const { local, foreign, resolve } = scene()
    addColumn(local, 'Fill1', 'text') // now local already has a 'Fill1' label
    const linked = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!
    expect(linked.label).toBe('Themes · Fill1')
  })
})

describe('effectiveColumns / findLinkedColumn', () => {
  it('appends linked columns after real ones', () => {
    const { local, resolve } = scene()
    const eff = effectiveColumns(local, resolve)
    expect(eff.map(c => c.label)).toEqual(['Name', 'Country', 'Fill1', 'Text'])
  })
  it('findLinkedColumn returns the linked column for its key, null otherwise', () => {
    const { local, foreign, resolve } = scene()
    expect(findLinkedColumn(local, resolve, `${foreign.id}::fill1`)?.sourceColumnKey).toBe('fill1')
    expect(findLinkedColumn(local, resolve, 'country')).toBe(null)
  })
})
