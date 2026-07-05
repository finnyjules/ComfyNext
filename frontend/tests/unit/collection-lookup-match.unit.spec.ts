import { describe, it, expect } from 'vitest'
import { autoMatchColumns, reconcileLinks, makeLookupResolver } from '~/lib/collection/lookup'
import { createCollection, addColumn } from '~/lib/collection/model'
import { COLLECTION_PROP } from '~/lib/collection/types'
import type { CollectionLink } from '~/lib/collection/types'

describe('autoMatchColumns', () => {
  const local = [{ key: 'name', label: 'Name', type: 'text' as const }, { key: 'country', label: 'Country', type: 'text' as const }]
  it('matches a single shared key', () => {
    const foreign = [{ key: 'country', label: 'Country', type: 'text' as const }, { key: 'fill1', label: 'Fill1', type: 'color' as const }]
    expect(autoMatchColumns(local, foreign)).toEqual({ matchLocal: 'country', matchForeign: 'country' })
  })
  it('returns null when no shared key', () => {
    expect(autoMatchColumns(local, [{ key: 'fill1', label: 'Fill1', type: 'color' as const }])).toBe(null)
  })
  it('returns null when ambiguous (two shared keys)', () => {
    const foreign = [{ key: 'name', label: 'Name', type: 'text' as const }, { key: 'country', label: 'Country', type: 'text' as const }]
    expect(autoMatchColumns(local, foreign)).toBe(null)
  })
})

describe('reconcileLinks', () => {
  const am = (id: string) => (id === 'T' ? { matchLocal: 'country', matchForeign: 'country' } : null)
  it('keeps links whose source still has an edge, drops the rest', () => {
    const existing: CollectionLink[] = [{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }, { collectionId: 'GONE', matchLocal: 'x', matchForeign: 'x' }]
    expect(reconcileLinks(existing, ['T'], am)).toEqual([{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }])
  })
  it('adds a new link via autoMatch, skips when autoMatch returns null', () => {
    expect(reconcileLinks([], ['T'], am)).toEqual([{ collectionId: 'T', matchLocal: 'country', matchForeign: 'country' }])
    expect(reconcileLinks([], ['U'], am)).toEqual([]) // autoMatch null → not added (picker will add later)
  })
})

describe('makeLookupResolver', () => {
  it('resolves a collection by its data id', () => {
    const c = createCollection('Themes'); addColumn(c, 'Country', 'text')
    const nodes = [{ id: '9', data: { properties: { [COLLECTION_PROP]: c } } }, { id: '3', data: {} }]
    const resolve = makeLookupResolver(nodes)
    expect(resolve(c.id)?.name).toBe('Themes')
    expect(resolve('missing')).toBe(undefined)
  })
})
