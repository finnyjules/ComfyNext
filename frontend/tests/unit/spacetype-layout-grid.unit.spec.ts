import { describe, it, expect } from 'vitest'
import { gridLayout } from '~/lib/spacetype/layouts/grid'
const P = { gridCols: 3, gridGap: 0.2, cardSize: 1 }
describe('grid layout', () => {
  it('maps i to (col,row) and centres the grid', () => {
    // 6 tiles, 3 cols → 2 rows; gap = 1.2. cols centre at (0,1,2)-1 = -1,0,1 ×1.2
    const t0 = gridLayout.place(0, 6, P as any, 0)   // col0,row0 (top-left)
    const t4 = gridLayout.place(4, 6, P as any, 0)   // col1,row1 (centre-bottom)
    expect(t0.x).toBeCloseTo(-1.2, 6); expect(t0.y).toBeCloseTo(0.6, 6)   // rows centred: row0 at +gap/2
    expect(t4.x).toBeCloseTo(0, 6);   expect(t4.y).toBeCloseTo(-0.6, 6)
    expect(t0.z).toBe(0); expect(t0.rotY).toBe(0)
  })
  it('is static (no loop rates)', () => { expect(gridLayout.loopRates!(P as any)).toEqual([]) })
})
