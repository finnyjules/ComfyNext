import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { resolveBindings } from '~/lib/collection/resolve'
import { linkedColumns } from '~/lib/collection/lookup'
import type { LookupResolver } from '~/lib/collection/lookup'
import type { VarBindings } from '~/lib/collection/types'

function scene() {
  const local = createCollection('Players')
  addColumn(local, 'Name', 'text'); addColumn(local, 'Country', 'text')
  const r = addRow(local); setCell(local, r.id, 'name', 'Mbappe'); setCell(local, r.id, 'country', 'France')
  const foreign = createCollection('Themes')
  addColumn(foreign, 'Country', 'text'); addColumn(foreign, 'Fill1', 'color')
  const fr = addRow(foreign); setCell(foreign, fr.id, 'country', 'France'); setCell(foreign, fr.id, 'fill1', '#0000ff')
  local.links = [{ collectionId: foreign.id, matchLocal: 'country', matchForeign: 'country' }]
  const resolve: LookupResolver = id => (id === foreign.id ? foreign : undefined)
  const fill1Key = linkedColumns(local, resolve).find(c => c.sourceColumnKey === 'fill1')!.key
  return { local, foreign, resolve, fill1Key }
}

describe('resolveBindings with a LookupResolver', () => {
  it('resolves a binding to a linked column through the join', () => {
    const { local, fill1Key, resolve } = scene()
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key } }
    const { values } = resolveBindings(local, bindings, 0, resolve)
    expect(values['params.fills.0.a']).toBe('#0000ff')
  })
  it('falls back to lastLiteral + missing when the linked cell has no match', () => {
    const { local, fill1Key, resolve } = scene()
    setCell(local, local.rows[0]!.id, 'country', 'Brazil') // no Brazil in Themes
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key, lastLiteral: '#123456' } }
    const { values, missing } = resolveBindings(local, bindings, 0, resolve)
    expect(values['params.fills.0.a']).toBe('#123456')
    expect(missing).toContain('params.fills.0.a')
  })
  it('is byte-identical to today when no resolver is passed', () => {
    const { local, fill1Key } = scene()
    const bindings: VarBindings = { 'params.fills.0.a': { collectionId: local.id, columnKey: fill1Key } }
    const { values, missing } = resolveBindings(local, bindings, 0) // no 4th arg
    expect(values['params.fills.0.a']).toBe(undefined) // linked column invisible without a resolver
    expect(missing).toContain('params.fills.0.a')
  })
})
