import { describe, expect, it } from 'vitest'
import { rotatedUnionBoxPx, unionBox } from '~~/app/lib/compositor/groupResize'

// `rotatedUnionBoxPx` backs ⌘2 (zoom to selection): it must union each member's
// ROTATED corner AABB, not its un-rotated box (that's what `unionBox` / the
// editor's `selectionBox` do, for the overlay rectangle — see the doc comment on
// `rotatedUnionBoxPx` for why the two stay different on purpose).
describe('rotatedUnionBoxPx', () => {
  it('empty selection → null', () => {
    expect(rotatedUnionBoxPx([], () => ({ w: 0, h: 0 }), 1000, 1000)).toBeNull()
  })

  it('rotation 0 degenerates to the plain unrotated union', () => {
    const members = [
      { x: 0.3, y: 0.3, rotation: 0 },
      { x: 0.7, y: 0.6, rotation: 0 },
    ]
    const boxPx = (m: { x: number; y: number }) => (m.x < 0.5 ? { w: 40, h: 40 } : { w: 60, h: 20 })
    const W = 1000, H = 1000
    const rotated = rotatedUnionBoxPx(members, boxPx, W, H)
    const plain = unionBox(members.map(m => ({ cx: m.x * W, cy: m.y * H, ...boxPx(m) })))
    expect(rotated).toEqual(plain)
  })

  it('a rotated member enlarges the union beyond the unrotated union', () => {
    // One axis-aligned member, one member rotated 45° — its rotated corner AABB
    // (a square rotated 45° has diagonal = side * sqrt(2)) sticks out further
    // than its own un-rotated box, so the union must grow to include it.
    const members = [
      { x: 0.5, y: 0.5, rotation: 0 },  // 100x100 box, centered — stays inside the rotated member's footprint
      { x: 0.5, y: 0.5, rotation: 45 }, // same box, rotated 45°
    ]
    const boxPx = () => ({ w: 100, h: 100 })
    const W = 1000, H = 1000

    const rotatedUnion = rotatedUnionBoxPx(members, boxPx, W, H)!
    const plainUnion = unionBox(members.map(m => ({ cx: m.x * W, cy: m.y * H, ...boxPx() })))

    // Plain union of two identical, identically-centered 100x100 boxes is just
    // that 100x100 box — rotation is invisible to it.
    expect(plainUnion.w).toBeCloseTo(100)
    expect(plainUnion.h).toBeCloseTo(100)

    // Rotated union must be strictly bigger: a 100x100 square rotated 45° has an
    // axis-aligned bounding box of side 100*sqrt(2) ≈ 141.42.
    const expectedSide = 100 * Math.sqrt(2)
    expect(rotatedUnion.w).toBeCloseTo(expectedSide, 5)
    expect(rotatedUnion.h).toBeCloseTo(expectedSide, 5)
    expect(rotatedUnion.w).toBeGreaterThan(plainUnion.w)
    expect(rotatedUnion.h).toBeGreaterThan(plainUnion.h)
    expect(rotatedUnion.cx).toBeCloseTo(500)
    expect(rotatedUnion.cy).toBeCloseTo(500)
  })

  it('a rotated member off-center shifts the AABB the way its corners actually land', () => {
    const members = [{ x: 0.2, y: 0.2, rotation: 90 }] // 90° rotation swaps w/h
    const boxPx = () => ({ w: 40, h: 20 })
    const W = 1000, H = 1000
    const b = rotatedUnionBoxPx(members, boxPx, W, H)!
    // At 90°, a 40x20 box's AABB becomes 20x40 (w/h swap, up to fp noise).
    expect(b.w).toBeCloseTo(20, 5)
    expect(b.h).toBeCloseTo(40, 5)
    expect(b.cx).toBeCloseTo(200)
    expect(b.cy).toBeCloseTo(200)
  })
})
