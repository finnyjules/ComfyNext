import { describe, expect, it } from 'vitest'
import {
  coverFirstRefs, defaultState, emptyState, identityRefs,
  normalizeStateId, panelFilename, pickState,
} from '#shared/characters/types'

const state = (over: Partial<ReturnType<typeof emptyState>> = {}) => ({ ...emptyState('default', 'Default'), ...over })

describe('normalizeStateId', () => {
  it('maps the default sentinel and empties to null', () => {
    expect(normalizeStateId('default')).toBe(null)
    expect(normalizeStateId('')).toBe(null)
    expect(normalizeStateId(undefined)).toBe(null)
    expect(normalizeStateId(null)).toBe(null)
  })
  it('passes real ids through', () => { expect(normalizeStateId('wet')).toBe('wet') })
})

describe('pickState', () => {
  const rec = { states: [state(), state({ id: 'wet', label: 'Wet' })] }
  it('null → default state', () => { expect(pickState(rec, null)?.id).toBe('default') })
  it('named → that state', () => { expect(pickState(rec, 'wet')?.id).toBe('wet') })
  it('unknown → default fallback', () => { expect(pickState(rec, 'gone')?.id).toBe('default') })
  it('no default → first', () => {
    expect(pickState({ states: [state({ id: 'only' })] }, null)?.id).toBe('only')
  })
})

describe('coverFirstRefs', () => {
  it('cover leads, order otherwise preserved', () => {
    expect(coverFirstRefs({ refImages: ['a', 'b', 'c'], coverIndex: 1 })).toEqual(['b', 'a', 'c'])
  })
  it('empty/undefined → []', () => { expect(coverFirstRefs(undefined)).toEqual([]) })
})

describe('identityRefs', () => {
  it('sheet leads when present', () => {
    const s = state({ sheetImage: 'sheet.png', refImages: ['a.png'], coverIndex: 0 })
    expect(identityRefs(s)).toEqual(['sheet.png', 'a.png'])
  })
  it('falls back to cover-first refs without a sheet', () => {
    const s = state({ refImages: ['a.png', 'b.png'], coverIndex: 1 })
    expect(identityRefs(s)).toEqual(['b.png', 'a.png'])
  })
})

describe('panelFilename', () => {
  it('finds a slot, null when missing', () => {
    const s = state({ panels: [{ slot: 'portrait', filename: 'p.png' }] })
    expect(panelFilename(s, 'portrait')).toBe('p.png')
    expect(panelFilename(s, 'body-back')).toBe(null)
  })
})
