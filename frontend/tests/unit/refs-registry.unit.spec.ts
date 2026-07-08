import { describe, it, expect } from 'vitest'
import {
  normalizeRefName, setRef, resolveRef, resolveRefFilename, resolveRefText,
  renameRef, removeRef, listRefNames, type RefRegistry,
} from '../../app/lib/refs/registry'

describe('normalizeRefName', () => {
  it('strips a leading @, trims, and keeps valid chars', () => {
    expect(normalizeRefName('@tracksuit')).toBe('tracksuit')
    expect(normalizeRefName('  Grey_Cyc-2 ')).toBe('Grey_Cyc-2')
  })
  it('collapses inner whitespace to a single hyphen', () => {
    expect(normalizeRefName('grey cyc')).toBe('grey-cyc')
  })
  it('rejects empty / invalid names as null', () => {
    expect(normalizeRefName('')).toBeNull()
    expect(normalizeRefName('@@@')).toBeNull()
    expect(normalizeRefName('   ')).toBeNull()
  })
})

describe('registry CRUD (immutable)', () => {
  it('setRef adds under the normalized key and does not mutate input', () => {
    const a: RefRegistry = {}
    const b = setRef(a, '@Tracksuit', { filename: 'suit.png' })
    expect(a).toEqual({})
    expect(b).toEqual({ Tracksuit: { filename: 'suit.png' } })
  })
  it('setRef is a no-op returning the same object for an invalid name', () => {
    const a: RefRegistry = { x: { filename: 'x.png' } }
    expect(setRef(a, '   ', { filename: 'y.png' })).toBe(a)
  })
  it('resolveRef / resolveRefFilename / resolveRefText tolerate a leading @', () => {
    const r = setRef({}, 'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' })
    expect(resolveRef(r, '@tracksuit')?.filename).toBe('suit.png')
    expect(resolveRefFilename(r, 'tracksuit')).toBe('suit.png')
    expect(resolveRefText(r, '@tracksuit')).toBe('black Nike tracksuit')
    expect(resolveRefFilename(r, 'missing')).toBeUndefined()
  })
  it('renameRef moves the entry and drops the old key', () => {
    const r = setRef({}, 'a', { filename: 'a.png' })
    expect(renameRef(r, 'a', 'b')).toEqual({ b: { filename: 'a.png' } })
  })
  it('removeRef deletes without mutating input', () => {
    const r = setRef({}, 'a', { filename: 'a.png' })
    expect(removeRef(r, 'a')).toEqual({})
    expect(r).toEqual({ a: { filename: 'a.png' } })
  })
  it('listRefNames returns names sorted', () => {
    const r = setRef(setRef({}, 'zed', { filename: 'z.png' }), 'alpha', { filename: 'a.png' })
    expect(listRefNames(r)).toEqual(['alpha', 'zed'])
  })
})
