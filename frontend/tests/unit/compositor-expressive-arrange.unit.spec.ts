import { describe, expect, it } from 'vitest'
import { arrangeMembers, unionBBoxPx } from '~~/app/lib/compositor/expressiveArrange'
import type { ExpressiveBoxParams } from '~~/shared/text-layout/boxes'

function params(p: Partial<ExpressiveBoxParams> = {}): ExpressiveBoxParams {
  return { placement: 'scatter', jitter: 0, rotation: 0, seed: 1, ...p }
}

describe('unionBBoxPx', () => {
  it('unions member centre+size boxes into one px rect', () => {
    const box = unionBBoxPx([
      { cx: 100, cy: 100, wPx: 40, hPx: 40 },   // 80..120
      { cx: 300, cy: 200, wPx: 60, hPx: 20 },   // x 270..330, y 190..210
    ])
    expect(box).toEqual({ x: 80, y: 80, w: 330 - 80, h: 210 - 80 })
  })
  it('empty → zero rect', () => {
    expect(unionBBoxPx([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('arrangeMembers', () => {
  const members = [
    { id: 'a', wPx: 80, hPx: 60 }, { id: 'b', wPx: 80, hPx: 60 },
    { id: 'c', wPx: 80, hPx: 60 }, { id: 'd', wPx: 80, hPx: 60 },
  ]
  const box = { x: 100, y: 50, w: 400, h: 300 }

  it('returns a centre-px position + rotation per member, offset by the box origin', () => {
    // scatter, jitter 0 → each item centered in the box; centre = boxOrigin + boxSize/2
    const out = arrangeMembers(members, box, params({ placement: 'scatter', jitter: 0 }))
    expect(out).toHaveLength(4)
    for (const r of out) {
      expect(r.cx).toBeCloseTo(100 + 200)   // box.x + boxW/2
      expect(r.cy).toBeCloseTo(50 + 150)    // box.y + boxH/2
      expect(r.rotation).toBe(0)
    }
  })

  it('grid keeps every member inside the box', () => {
    const out = arrangeMembers(members, box, params({ placement: 'grid', columns: 2, jitter: 1, seed: 4 }))
    for (const r of out) {
      expect(r.cx - 40).toBeGreaterThanOrEqual(100 - 1e-6)
      expect(r.cx + 40).toBeLessThanOrEqual(500 + 1e-6)
      expect(r.cy - 30).toBeGreaterThanOrEqual(50 - 1e-6)
      expect(r.cy + 30).toBeLessThanOrEqual(350 + 1e-6)
    }
  })
})
