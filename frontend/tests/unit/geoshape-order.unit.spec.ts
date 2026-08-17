import { describe, it, expect } from 'vitest'
import { rankOrder } from '../../app/lib/geoshape/order'

// 2x2 grid: index 0=TL,1=TR,2=BL,3=BR (row-major). cx/cy in a grid, band=100.
const grid = [
  { cx: 0, cy: 0, i: 0 }, { cx: 200, cy: 0, i: 1 },
  { cx: 0, cy: 200, i: 2 }, { cx: 200, cy: 200, i: 3 },
]
describe('rankOrder', () => {
  it('created/depth are identity', () => {
    expect(rankOrder(grid, 'created', 100)).toEqual([0, 1, 2, 3])
    expect(rankOrder(grid, 'depth', 100)).toEqual([0, 1, 2, 3])
  })
  it('leftRight ranks by x (ties by index)', () => {
    // x: TL,BL=0 (ranks 0,1 by index) ; TR,BR=200 (ranks 2,3)
    expect(rankOrder(grid, 'leftRight', 100)).toEqual([0, 2, 1, 3])
  })
  it('topBottom ranks by y', () => {
    expect(rankOrder(grid, 'topBottom', 100)).toEqual([0, 1, 2, 3])
  })
  it('rows = reading order (row band, then x)', () => {
    // row0: TL(rank0),TR(rank1); row1: BL(rank2),BR(rank3)
    expect(rankOrder(grid, 'rows', 100)).toEqual([0, 1, 2, 3])
  })
  it('columns = down a column, then next column', () => {
    // col0: TL(rank0),BL(rank1); col1: TR(rank2),BR(rank3)
    expect(rankOrder(grid, 'columns', 100)).toEqual([0, 2, 1, 3])
  })
  it('centerOut ranks by distance from centroid', () => {
    const r = rankOrder(grid, 'centerOut', 100)
    expect(new Set(r)).toEqual(new Set([0, 1, 2, 3])) // a permutation; symmetric grid → all equidistant, stable by index
    expect(r).toEqual([0, 1, 2, 3])
  })
  it('around sweeps by angle', () => {
    const r = rankOrder(grid, 'around', 100)
    expect(new Set(r)).toEqual(new Set([0, 1, 2, 3]))
  })
})
