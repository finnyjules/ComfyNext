import { describe, it, expect } from 'vitest'
import { sequenceIndex } from '../../app/lib/engine/sources/sequenceSource'

describe('sequenceIndex', () => {
  it('wraps modulo the sequence length with in_frame offset', () => {
    expect(sequenceIndex(0, 0, 10)).toBe(0)
    expect(sequenceIndex(3, 0, 10)).toBe(3)
    expect(sequenceIndex(12, 0, 10)).toBe(2)
    expect(sequenceIndex(3, 4, 10)).toBe(7)
    expect(sequenceIndex(9, 4, 10)).toBe(3)   // (9+4) % 10
  })
  it('clamps degenerate lengths', () => {
    expect(sequenceIndex(5, 0, 0)).toBe(0)
    expect(sequenceIndex(5, 0, 1)).toBe(0)
  })
})
