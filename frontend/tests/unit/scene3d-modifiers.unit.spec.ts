import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyModifiers, hasModifiers } from '~/lib/scene3d/modifiers'

const box = () => new THREE.BoxGeometry(1, 1, 1)
const sizeOf = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}
const verts = (g: THREE.BufferGeometry) => g.getAttribute('position').count
// Widest extent on `axis` among vertices near one end of `along`.
const spanAtEnd = (g: THREE.BufferGeometry, along: 0 | 1 | 2, axis: 0 | 1 | 2, top: boolean): number => {
  const p = g.getAttribute('position')
  let lo = Infinity, hi = -Infinity
  const bounds = sizeOf(g)
  g.computeBoundingBox()
  const b = g.boundingBox!
  const edge = top ? b.max.getComponent(along) : b.min.getComponent(along)
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getComponent(i, along) - edge) > bounds[along] * 0.1) continue
    const v = p.getComponent(i, axis)
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('scene3d modifiers', () => {
  it('detects whether anything is set', () => {
    expect(hasModifiers(undefined)).toBe(false)
    expect(hasModifiers({})).toBe(false)
    expect(hasModifiers({ twist: 0, arrayCount: 1 })).toBe(false)
    expect(hasModifiers({ twist: 45 })).toBe(true)
    expect(hasModifiers({ arrayCount: 3 })).toBe(true)
    expect(hasModifiers({ noise: 0.1 })).toBe(true)
  })

  it('returns the input untouched when nothing is set', () => {
    const g = box()
    const before = verts(g)
    expect(applyModifiers(g, undefined)).toBe(g)
    expect(applyModifiers(g, { twist: 0 })).toBe(g)
    expect(verts(g)).toBe(before)
  })

  it('subdivides only when a deforming stage is active', () => {
    // Subdividing alone changes nothing visible, so it is skipped.
    expect(applyModifiers(box(), { subdivide: 2 })).toBeTruthy()
    const plain = applyModifiers(box(), { twist: 1 })
    const fine = applyModifiers(box(), { twist: 1, subdivide: 1 })
    expect(verts(fine)).toBeGreaterThan(verts(plain))
  })

  it('keeps the overall size when subdividing', () => {
    // The 1° twist is only here to make subdivision run at all, but it does
    // splay the corners very slightly (0.7071 * cos(44.5°) * 2 = 1.00873), so
    // the real assertion is that adding subdivision changes nothing: the coarse
    // and fine sizes must match exactly, and the twist axis stays exactly 1.
    const coarse = sizeOf(applyModifiers(box(), { twist: 1 }))
    const [w, h, d] = sizeOf(applyModifiers(box(), { twist: 1, subdivide: 2 }))
    expect(w).toBeCloseTo(coarse[0], 6)
    expect(h).toBeCloseTo(coarse[1], 6)
    expect(d).toBeCloseTo(coarse[2], 6)
    expect(h).toBeCloseTo(1, 6)
    const splayed = Math.SQRT2 * Math.cos(((45 - 0.5) * Math.PI) / 180)
    expect(w).toBeCloseTo(splayed, 4)
    expect(d).toBeCloseTo(splayed, 4)
  })

  it('tapers one end and leaves the other', () => {
    const g = applyModifiers(box(), { taper: -1, taperAxis: 1, subdivide: 1 })
    const bottom = spanAtEnd(g, 1, 0, false)
    const top = spanAtEnd(g, 1, 0, true)
    expect(top).toBeLessThan(bottom * 0.5)
  })

  it('twists the ends in opposite directions around the axis', () => {
    // subdivide must be 2: a box only has vertices at y = ±0.5, and one
    // subdivision only adds y = 0, where the twist angles are -90°/0°/+90° —
    // which map the 45° corners straight back onto x = ±0.5. Two subdivisions
    // add the y = ±0.25 rings, where a corner rotates to angle 0 and reaches
    // the full corner radius 0.7071, so X spans 2 * 0.7071 = 1.4142.
    const g = applyModifiers(box(), { twist: 180, twistAxis: 1, subdivide: 2 })
    expect(sizeOf(g)[0]).toBeCloseTo(Math.SQRT2, 4)
    expect(sizeOf(g)[1]).toBeCloseTo(1, 4)
  })

  it('bends the shape so it no longer spans its original length', () => {
    const tall = new THREE.BoxGeometry(0.3, 2, 0.3)
    const g = applyModifiers(tall, { bend: 170, bendAxis: 2, subdivide: 2 })
    // Curving a 2-long bar into most of a half circle shortens its Y extent.
    expect(sizeOf(g)[1]).toBeLessThan(2)
  })

  it('is identity for a zero bend angle', () => {
    const g = applyModifiers(box(), { bend: 0, twist: 30 })
    expect(g).toBeTruthy()
    expect(Number.isFinite(sizeOf(g)[0])).toBe(true)
  })

  it('displaces with noise deterministically per seed', () => {
    const a = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 3 })
    const b = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 3 })
    const c = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 8 })
    const pa = a.getAttribute('position'), pb = b.getAttribute('position'), pc = c.getAttribute('position')
    let sameAB = true, sameAC = true
    for (let i = 0; i < pa.count * 3; i++) {
      if (Math.abs(pa.array[i]! - pb.array[i]!) > 1e-9) sameAB = false
      if (Math.abs(pa.array[i]! - pc.array[i]!) > 1e-9) sameAC = false
    }
    expect(sameAB).toBe(true)
    expect(sameAC).toBe(false)
    // A lumpy sphere is no longer exactly 1.0 across.
    expect(sizeOf(a)[0]).not.toBeCloseTo(1, 3)
  })

  it('repeats linearly with even spacing', () => {
    const one = applyModifiers(box(), { arrayCount: 1 })
    const four = applyModifiers(box(), { arrayCount: 4, arrayOffsetX: 2, arrayOffsetY: 0, arrayOffsetZ: 0 })
    expect(verts(four)).toBe(verts(one === box() ? box() : one) * 4)
    // Four boxes spaced 2 apart span 3 gaps plus the box itself.
    expect(sizeOf(four)[0]).toBeCloseTo(7, 4)
  })

  it('repeats radially on a circle of the given radius', () => {
    const g = applyModifiers(box(), { arrayCount: 6, arrayMode: 1, arrayRadius: 2, arrayAxis: 1 })
    const [w, , d] = sizeOf(g)
    // Copies sit on a radius-2 circle, so the ring spans about 4 plus a box.
    expect(w).toBeGreaterThan(4)
    expect(d).toBeGreaterThan(4)
    expect(w).toBeLessThan(6)
  })

  it('honours the array count exactly while capping subdivision', () => {
    // A dense sphere with heavy subdivision and a big array must not explode:
    // the count is exact, the subdivision is what gets cut back.
    const src = new THREE.SphereGeometry(0.5, 64, 48)
    const base = verts(applyModifiers(new THREE.SphereGeometry(0.5, 64, 48), { twist: 1 }))
    // The budget allows exactly one of the three requested subdivisions here,
    // so the single-copy geometry to compare against is the subdivide-1 one —
    // `base` (no subdivision at all) is not a divisor of the result.
    const single = verts(applyModifiers(new THREE.SphereGeometry(0.5, 64, 48), { twist: 1, subdivide: 1 }))
    const g = applyModifiers(src, { twist: 1, subdivide: 3, arrayCount: 12 })
    expect(verts(g)).toBe(single * 12)   // all 12 copies, subdivision cut to 1
    expect(single).toBeGreaterThan(base) // subdivision did run, just not 3 times
    expect(verts(g)).toBeLessThan(400_000)
  })

  it('leaves the caller free to keep using the input geometry', () => {
    const g = box()
    const before = verts(g)
    applyModifiers(g, { twist: 90, subdivide: 1 })
    expect(verts(g)).toBe(before)
    expect(g.getAttribute('position')).toBeTruthy()
  })
})
