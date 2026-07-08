import { describe, it, expect } from 'vitest'
import { refBinding, isRefBinding, refBindingLabel } from '../../app/lib/refs/binding'

describe('reference bindings', () => {
  it('refBinding builds a reference-kind VarBinding', () => {
    expect(refBinding('tracksuit')).toEqual({ kind: 'reference', refName: 'tracksuit', collectionId: '', columnKey: '' })
  })
  it('isRefBinding is true only for kind reference', () => {
    expect(isRefBinding(refBinding('a'))).toBe(true)
    expect(isRefBinding({ collectionId: 'c', columnKey: 'k' })).toBe(false)
    expect(isRefBinding(undefined)).toBe(false)
  })
  it('refBindingLabel returns @name for a ref binding, null otherwise', () => {
    expect(refBindingLabel(refBinding('grey-cyc'))).toBe('@grey-cyc')
    expect(refBindingLabel({ collectionId: 'c', columnKey: 'k' })).toBeNull()
  })
})
