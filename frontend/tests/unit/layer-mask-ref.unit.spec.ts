import { describe, it, expect } from 'vitest'
import { layerMaskRef } from '~/composables/useCompositorLayers'

describe('layerMaskRef', () => {
  it('returns the explicit StackKey when maskedByKey is set', () => {
    expect(layerMaskRef({ maskedByKey: 'w:2' })).toBe('w:2')
    expect(layerMaskRef({ maskedByKey: 'l:abc' })).toBe('l:abc')
  })
  it('upgrades a legacy local maskedById to an l: key', () => {
    expect(layerMaskRef({ maskedById: 'abc' })).toBe('l:abc')
  })
  it('prefers maskedByKey over a legacy maskedById', () => {
    expect(layerMaskRef({ maskedByKey: 'w:1', maskedById: 'abc' })).toBe('w:1')
  })
  it('returns undefined when neither is set', () => {
    expect(layerMaskRef({})).toBeUndefined()
    expect(layerMaskRef({ maskedById: '' })).toBeUndefined()
  })
})
