import { describe, it, expect } from 'vitest'
import { creditsForUsd, formatCostBadge, formatCostLong } from '../../app/lib/pricing'

describe('creditsForUsd (client mirror of the server markup policy)', () => {
  it('2x under/at $0.10, 1.5x above, 1-credit floor', () => {
    expect(creditsForUsd(0.03)).toBe(6)     // flux-dev-class 2x
    expect(creditsForUsd(0.10)).toBe(20)    // boundary is 2x
    expect(creditsForUsd(0.15)).toBe(23)    // nano-banana 1.5x — matches book
    expect(creditsForUsd(0.48)).toBe(72)    // hunyuan3d 1.5x — matches book
    expect(creditsForUsd(0.0004)).toBe(1)   // floor
    expect(creditsForUsd(0)).toBe(0)        // unpriced stays zero
  })
})

describe('formatCostBadge', () => {
  it('local mode keeps dollars with optional approximation', () => {
    expect(formatCostBadge(0.08, false, false)).toBe('$0.08')
    expect(formatCostBadge(0.08, true, false)).toBe('~$0.08')
  })
  it('hosted mode shows credits, always approximate (book may diverge)', () => {
    expect(formatCostBadge(0.08, false, true)).toBe('~16 cr')
    expect(formatCostBadge(0.40, true, true)).toBe('~60 cr')
  })
})

describe('formatCostLong', () => {
  it('dialog forms', () => {
    expect(formatCostLong(0.40, false)).toBe('$0.40')
    expect(formatCostLong(0.40, true)).toBe('~60 credits')
  })
})
