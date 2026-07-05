import { describe, it, expect } from 'vitest'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import { pushVarPreview } from '~/lib/collection/preview'
import { linkedColumns, makeLookupResolver } from '~/lib/collection/lookup'
import { BINDINGS_PROP, COLLECTION_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'

function scene() {
  const players = createCollection('Players')
  addColumn(players, 'Name', 'text'); addColumn(players, 'Country', 'text')
  const r = addRow(players); setCell(players, r.id, 'name', 'Mbappe'); setCell(players, r.id, 'country', 'France')
  const themes = createCollection('Themes')
  addColumn(themes, 'Country', 'text'); addColumn(themes, 'Fill1', 'color')
  const tr = addRow(themes); setCell(themes, tr.id, 'country', 'France'); setCell(themes, tr.id, 'fill1', '#0000ff')
  players.links = [{ collectionId: themes.id, matchLocal: 'country', matchForeign: 'country' }]

  const playersNode = { id: '1', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: players } } }
  const themesNode = { id: '2', data: { nodeType: 'Collection', properties: { [COLLECTION_PROP]: themes } } }
  const fill1Key = linkedColumns(players, makeLookupResolver([playersNode, themesNode])).find(c => c.sourceColumnKey === 'fill1')!.key
  const studio = { id: '3', data: { nodeType: 'SpaceType', properties: {
    [BINDINGS_PROP]: { 'params.fills.0.a': { collectionId: players.id, columnKey: fill1Key } },
  } } }
  return { playersNode, themesNode, studio }
}

describe('pushVarPreview with lookups', () => {
  it('resolves a bound linked column into the target preview payload', () => {
    const { playersNode, themesNode, studio } = scene()
    pushVarPreview(playersNode, [studio], [playersNode, themesNode, studio])
    const preview = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(preview.params['fills.0.a']).toBe('#0000ff') // Mbappe -> France -> blue, through the link
  })
  it('without allNodes, the linked column is unresolved (backward-compatible)', () => {
    const { playersNode, studio } = scene()
    pushVarPreview(playersNode, [studio]) // no allNodes
    const preview = (studio.data.properties as any)[VAR_PREVIEW_PROP]
    expect(preview.params['fills.0.a']).toBe(undefined)
  })
})
