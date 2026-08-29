import { describe, it, expect } from 'vitest'
import { solveLinear } from '~/lib/sketch/linalg'

describe('solveLinear', () => {
  it('solves a 2x2 system', () => {
    // 2x + y = 5 ; x + 3y = 10  → x=1, y=3
    const x = solveLinear([[2, 1], [1, 3]], [5, 10])!
    expect(x[0]).toBeCloseTo(1, 9)
    expect(x[1]).toBeCloseTo(3, 9)
  })
  it('returns null for a singular matrix', () => {
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })
})
