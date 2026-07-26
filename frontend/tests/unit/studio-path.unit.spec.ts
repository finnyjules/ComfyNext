import { describe, it, expect } from 'vitest'
import { getByPath, setByPath } from '../../app/lib/studio/path'

describe('getByPath', () => {
  it('reads a nested value', () => {
    expect(getByPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5)
  })
  it('reads through an array index', () => {
    expect(getByPath({ layers: [{ shape: { count: 12 } }] }, 'layers.0.shape.count')).toBe(12)
  })
  it('returns undefined for a missing hop instead of throwing', () => {
    expect(getByPath({ a: {} }, 'a.b.c')).toBeUndefined()
  })
  it('returns undefined when traversing through null', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined()
  })
  it('returns undefined for an empty path', () => {
    expect(getByPath({ a: 1 }, '')).toBeUndefined()
  })
})

describe('setByPath', () => {
  it('writes a nested value', () => {
    const o: any = { a: { b: { c: 1 } } }
    setByPath(o, 'a.b.c', 9)
    expect(o.a.b.c).toBe(9)
  })
  it('writes through an existing array index', () => {
    const o: any = { layers: [{ shape: { count: 1 } }] }
    setByPath(o, 'layers.0.shape.count', 42)
    expect(o.layers[0].shape.count).toBe(42)
  })
  it('creates an ARRAY when the next key is numeric', () => {
    const o: any = {}
    setByPath(o, 'layers.0.count', 3)
    expect(Array.isArray(o.layers)).toBe(true)
    expect(o.layers[0].count).toBe(3)
  })
  it('creates an OBJECT when the next key is not numeric', () => {
    const o: any = {}
    setByPath(o, 'focus.blur', 0.5)
    expect(Array.isArray(o.focus)).toBe(false)
    expect(o.focus.blur).toBe(0.5)
  })
  it('does not clobber an existing array with an object', () => {
    const o: any = { layers: [{ shape: {} }] }
    setByPath(o, 'layers.1.shape.count', 7)
    expect(Array.isArray(o.layers)).toBe(true)
    expect(o.layers[1].shape.count).toBe(7)
  })
  it('is a no-op on an empty path', () => {
    const o: any = { a: 1 }
    setByPath(o, '', 5)
    expect(o).toEqual({ a: 1 })
  })
})
