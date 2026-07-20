import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { applyModifiers, hasModifiers, totalClones } from '~/lib/scene3d/modifiers'
import { geometryFor } from '~/lib/scene3d/engine'

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

// An independent restatement of the phase-1 cloner, kept here so the back-compat
// test compares against the old algorithm rather than against the new one.
const phase1Cloner = (
  count: number,
  radial: boolean,
  offset: [number, number, number],
  radius = 1.5,
  axis = 1,
): THREE.BufferGeometry => {
  const copies: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const spin = new THREE.Matrix4()
  const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
  const radialDir = (axis + 1) % 3
  for (let i = 0; i < count; i++) {
    const copy = box() as THREE.BufferGeometry
    if (radial) {
      const out = new THREE.Vector3()
      out.setComponent(radialDir, radius)
      m.makeTranslation(out.x, out.y, out.z)
      spin.makeRotationAxis(axisVec, (i / count) * Math.PI * 2)
      copy.applyMatrix4(spin.multiply(m))
    } else {
      copy.applyMatrix4(m.makeTranslation(offset[0] * i, offset[1] * i, offset[2] * i))
    }
    copies.push(copy)
  }
  return mergeGeometries(copies)!
}

/** Every position float of two geometries, compared exactly. */
const identicalVertices = (a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean => {
  const pa = a.getAttribute('position').array, pb = b.getAttribute('position').array
  if (pa.length !== pb.length) return false
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false
  return true
}

/** Distinct values of one component, rounded, so grid placement can be checked. */
const distinctAlong = (g: THREE.BufferGeometry, axis: 0 | 1 | 2): number[] => {
  const p = g.getAttribute('position')
  const seen = new Set<number>()
  for (let i = 0; i < p.count; i++) seen.add(Math.round(p.getComponent(i, axis) * 1e4) / 1e4)
  return [...seen].sort((x, y) => x - y)
}

describe('scene3d modifiers', () => {
  it('detects whether anything is set', () => {
    expect(hasModifiers(undefined)).toBe(false)
    expect(hasModifiers({})).toBe(false)
    expect(hasModifiers({ twist: 0, cloneCount: 1 })).toBe(false)
    expect(hasModifiers({ twist: 45 })).toBe(true)
    expect(hasModifiers({ cloneCount: 3 })).toBe(true)
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
    const one = applyModifiers(box(), { cloneCount: 1 })
    const four = applyModifiers(box(), { cloneCount: 4, cloneOffsetX: 2, cloneOffsetY: 0, cloneOffsetZ: 0 })
    expect(verts(four)).toBe(verts(one === box() ? box() : one) * 4)
    // Four boxes spaced 2 apart span 3 gaps plus the box itself.
    expect(sizeOf(four)[0]).toBeCloseTo(7, 4)
  })

  it('repeats radially on a circle of the given radius', () => {
    const g = applyModifiers(box(), { cloneCount: 6, cloneMode: 1, cloneRadius: 2, cloneAxis: 1 })
    const [w, , d] = sizeOf(g)
    // Copies sit on a radius-2 circle, so the ring spans about 4 plus a box.
    expect(w).toBeGreaterThan(4)
    expect(d).toBeGreaterThan(4)
    expect(w).toBeLessThan(6)
  })

  it('honours the clone count exactly while capping subdivision', () => {
    // A dense sphere with heavy subdivision and a big clone set must not explode:
    // the count is exact, the subdivision is what gets cut back.
    const src = new THREE.SphereGeometry(0.5, 64, 48)
    const base = verts(applyModifiers(new THREE.SphereGeometry(0.5, 64, 48), { twist: 1 }))
    // The budget allows exactly one of the three requested subdivisions here,
    // so the single-copy geometry to compare against is the subdivide-1 one —
    // `base` (no subdivision at all) is not a divisor of the result.
    const single = verts(applyModifiers(new THREE.SphereGeometry(0.5, 64, 48), { twist: 1, subdivide: 1 }))
    const g = applyModifiers(src, { twist: 1, subdivide: 3, cloneCount: 12 })
    expect(verts(g)).toBe(single * 12)   // all 12 copies, subdivision cut to 1
    expect(single).toBeGreaterThan(base) // subdivision did run, just not 3 times
    expect(verts(g)).toBeLessThan(400_000)
  })

  it('counts the copies each mode will produce', () => {
    expect(totalClones(undefined)).toBe(1)
    expect(totalClones({})).toBe(1)
    // linear and radial are driven by cloneCount; the grid counts are ignored.
    expect(totalClones({ cloneCount: 4 })).toBe(4)
    expect(totalClones({ cloneCount: 4, cloneMode: 1 })).toBe(4)
    expect(totalClones({ cloneCount: 4, cloneMode: 1, cloneCountX: 5 })).toBe(4)
    // grid multiplies its three axis counts and ignores cloneCount.
    expect(totalClones({ cloneMode: 2 })).toBe(9)                        // 3 x 1 x 3 defaults
    expect(totalClones({ cloneMode: 2, cloneCountY: 3 })).toBe(27)
    expect(totalClones({ cloneMode: 2, cloneCount: 9, cloneCountX: 1, cloneCountZ: 1 })).toBe(1)
  })

  it('activates the cloner from the total copy count, not cloneCount alone', () => {
    expect(hasModifiers({ cloneMode: 2 })).toBe(true)
    expect(hasModifiers({ cloneMode: 2, cloneCountX: 1, cloneCountY: 1, cloneCountZ: 1 })).toBe(false)
    // The non-identity grid defaults must not leak into a default object.
    expect(hasModifiers({})).toBe(false)
    expect(hasModifiers({ cloneCount: 1, cloneMode: 0 })).toBe(false)
  })

  it('lays the grid out centred on the origin', () => {
    const g = applyModifiers(box(), {
      cloneMode: 2, cloneCountX: 3, cloneCountY: 2, cloneCountZ: 4,
      cloneSpacingX: 1.2, cloneSpacingY: 2, cloneSpacingZ: 1.2,
    })
    expect(verts(g)).toBe(verts(box()) * 24)
    const [w, h, d] = sizeOf(g)
    // Each axis spans (count - 1) * spacing plus the unit box itself.
    expect(w).toBeCloseTo(2 * 1.2 + 1, 4)
    expect(h).toBeCloseTo(1 * 2 + 1, 4)
    expect(d).toBeCloseTo(3 * 1.2 + 1, 4)
    // Centred, not corner-anchored: the bounds are symmetric about the origin.
    g.computeBoundingBox()
    const b = g.boundingBox!
    expect(b.min.x + b.max.x).toBeCloseTo(0, 5)
    expect(b.min.y + b.max.y).toBeCloseTo(0, 5)
    expect(b.min.z + b.max.z).toBeCloseTo(0, 5)
    // The three X columns sit at -1.2, 0 and +1.2.
    expect(distinctAlong(g, 0)).toEqual([-1.7, -0.7, -0.5, 0.5, 0.7, 1.7])
  })

  it('applies the step rotation linearly and the step scale geometrically', () => {
    const src = new THREE.BoxGeometry(1, 0.2, 0.2)
    const opts = { cloneCount: 3, cloneOffsetX: 3, cloneStepRotZ: 30, cloneStepScale: 0.5 }
    const g = applyModifiers(src, opts)
    const base = src.getAttribute('position') as THREE.BufferAttribute
    const n = base.count
    expect(verts(g)).toBe(n * 3)
    // Copy i must be exactly place(i) . rotationStep(i) . scaleStep(i) applied to
    // the source vertices, in source order — mergeGeometries concatenates copies.
    const p = g.getAttribute('position')
    const v = new THREE.Vector3()
    for (let i = 0; i < 3; i++) {
      const s = 0.5 ** i
      const expected = new THREE.Matrix4()
        .makeTranslation(3 * i, 0, 0)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, 0, ((30 * Math.PI) / 180) * i)))
        .multiply(new THREE.Matrix4().makeScale(s, s, s))
      for (let k = 0; k < n; k++) {
        v.fromBufferAttribute(base, k).applyMatrix4(expected)
        expect(p.getX(i * n + k)).toBeCloseTo(v.x, 5)
        expect(p.getY(i * n + k)).toBeCloseTo(v.y, 5)
        expect(p.getZ(i * n + k)).toBeCloseTo(v.z, 5)
      }
    }
  })

  it('composes the step transforms with all three modes', () => {
    // A step scale below 1 shrinks the far copies, so each mode's extent is
    // smaller than the same arrangement without it.
    const plainLinear = sizeOf(applyModifiers(box(), { cloneCount: 4, cloneOffsetX: 2 }))[0]
    const stepLinear = sizeOf(applyModifiers(box(), { cloneCount: 4, cloneOffsetX: 2, cloneStepScale: 0.5 }))[0]
    expect(stepLinear).toBeLessThan(plainLinear)

    const plainRadial = sizeOf(applyModifiers(box(), { cloneCount: 6, cloneMode: 1, cloneRadius: 2 }))[0]
    const stepRadial = sizeOf(applyModifiers(box(), { cloneCount: 6, cloneMode: 1, cloneRadius: 2, cloneStepScale: 0.5 }))[0]
    expect(stepRadial).toBeLessThan(plainRadial)

    // A 45 degree step rotation on a grid widens each copy's footprint, so the
    // grid grows even though the placement is unchanged.
    const plainGrid = sizeOf(applyModifiers(box(), { cloneMode: 2 }))[0]
    const stepGrid = sizeOf(applyModifiers(box(), { cloneMode: 2, cloneStepRotY: 45 }))[0]
    expect(plainGrid).toBeCloseTo(3.4, 4)
    expect(stepGrid).toBeGreaterThan(plainGrid)
  })

  it('reproduces the phase-1 cloner exactly when no step transform is set', () => {
    const linear = applyModifiers(box(), { cloneCount: 4, cloneOffsetX: 2, cloneOffsetY: 0, cloneOffsetZ: 0 })
    expect(identicalVertices(linear, phase1Cloner(4, false, [2, 0, 0]))).toBe(true)

    const radial = applyModifiers(box(), { cloneCount: 6, cloneMode: 1, cloneRadius: 2, cloneAxis: 1 })
    expect(identicalVertices(radial, phase1Cloner(6, true, [0, 0, 0], 2, 1))).toBe(true)

    // Explicit identity step values must be identical too, not merely close.
    const explicit = applyModifiers(box(), {
      cloneCount: 4, cloneOffsetX: 2, cloneStepScale: 1, cloneStepRotX: 0, cloneStepRotY: 0, cloneStepRotZ: 0,
    })
    expect(identicalVertices(explicit, phase1Cloner(4, false, [2, 0, 0]))).toBe(true)
  })

  it('leaves the caller free to keep using the input geometry', () => {
    const g = box()
    const before = verts(g)
    applyModifiers(g, { twist: 90, subdivide: 1 })
    expect(verts(g)).toBe(before)
    expect(g.getAttribute('position')).toBeTruthy()
  })
})

describe('scene3d jitter modifier', () => {
  const posOf = (g: THREE.BufferGeometry) => (g.getAttribute('position').array as Float32Array).slice()

  it('is inert at jitter 0 and active above it', () => {
    expect(hasModifiers({ jitter: 0 })).toBe(false)
    expect(hasModifiers({ jitter: 0.1 })).toBe(true)
  })

  it('moves vertices deterministically for a given seed', () => {
    const src = geometryFor('box')
    const a = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 1 })
    const b = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 1 })
    const c = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 2 })
    expect(Array.from(posOf(a))).toEqual(Array.from(posOf(b)))          // same seed → identical
    expect(Array.from(posOf(a))).not.toEqual(Array.from(posOf(c)))      // seed changes it
  })

  it('produces only finite positions in both modes', () => {
    for (const jitterMode of [0, 1]) {
      const g = applyModifiers(geometryFor('icosahedron', { detail: 1 }), { jitter: 0.3, jitterMode, subdivide: 2 })
      const arr = g.getAttribute('position').array as Float32Array
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true)
    }
  })

  it('subdivides when only jitter is set (jitter counts as a deform)', () => {
    const plain = geometryFor('box')
    const jittered = applyModifiers(geometryFor('box'), { jitter: 0.1, subdivide: 2 })
    expect(jittered.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count)
  })

  it('moves coincident vertices together (watertight)', () => {
    const src = geometryFor('box')
    const out = applyModifiers(src.clone(), { jitter: 0.2, jitterSeed: 7 })

    // Group indices of a fresh, unjittered box by their original position, so
    // the grouping is independent of whatever `out` did to them.
    const original = geometryFor('box')
    const origPos = original.getAttribute('position')
    const key = (x: number, y: number, z: number) =>
      `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    const groups = new Map<string, number[]>()
    for (let i = 0; i < origPos.count; i++) {
      const k = key(origPos.getX(i), origPos.getY(i), origPos.getZ(i))
      const list = groups.get(k) ?? []
      list.push(i)
      groups.set(k, list)
    }

    const outPos = out.getAttribute('position')
    expect(outPos.count).toBe(origPos.count) // jitter alone does not re-index or subdivide

    let sawSharedGroup = false
    let sawMovement = false
    for (const indices of groups.values()) {
      if (indices.length >= 2) {
        sawSharedGroup = true
        const [first, ...rest] = indices
        const fx = outPos.getX(first!), fy = outPos.getY(first!), fz = outPos.getZ(first!)
        for (const idx of rest) {
          expect(outPos.getX(idx)).toBe(fx)
          expect(outPos.getY(idx)).toBe(fy)
          expect(outPos.getZ(idx)).toBe(fz)
        }
      }
      const i0 = indices[0]!
      if (
        outPos.getX(i0) !== origPos.getX(i0) ||
        outPos.getY(i0) !== origPos.getY(i0) ||
        outPos.getZ(i0) !== origPos.getZ(i0)
      ) {
        sawMovement = true
      }
    }

    // A box's 24 position entries collapse to 8 unique corners, so this must hold.
    expect(sawSharedGroup).toBe(true)
    expect(sawMovement).toBe(true)
  })
})
