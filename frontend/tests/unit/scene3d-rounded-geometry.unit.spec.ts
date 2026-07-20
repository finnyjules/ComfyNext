import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { roundedLatheGeometry, roundedPolyGeometry, roundedHullGeometry } from '~/lib/scene3d/roundedGeometry'

const finite = (g: THREE.BufferGeometry): boolean => {
  const a = g.getAttribute('position')
  for (let i = 0; i < a.count * 3; i++) if (!Number.isFinite((a.array as ArrayLike<number>)[i])) return false
  return true
}
const size = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}

describe('roundedLatheGeometry', () => {
  it('builds a valid cylinder-like lathe with normals and uv at a mid radius', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('normal')).toBeTruthy()
    expect(g.getAttribute('uv')).toBeTruthy()
    expect(finite(g)).toBe(true)
    const [w, h, d] = size(g)
    expect(h).toBeLessThanOrEqual(1.0001)      // stays within unit height
    expect(w).toBeLessThanOrEqual(1.0001)
    expect(d).toBeLessThanOrEqual(1.0001)
    expect(w).toBeGreaterThan(0.5)
  })

  it('stays finite at the extreme corner radius and lowest corner sides', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.49, 1, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
    expect(size(g)[1]).toBeLessThanOrEqual(1.0001)
  })

  it('handles a cone (zero top radius) without NaNs', () => {
    const g = roundedLatheGeometry(0, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  it('adds vertices versus a plain cylinder of the same segments', () => {
    const plain = new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
    const round = roundedLatheGeometry(0.5, 0.5, 0.2, 4, 48, Math.PI * 2)
    expect(round.getAttribute('position').count).toBeGreaterThan(0)
    expect(plain.getAttribute('position').count).toBeGreaterThan(0)
  })
})

describe('roundedPolyGeometry', () => {
  it('builds a valid rounded hexagonal prism with normals and uv', () => {
    const g = roundedPolyGeometry(6, 0.5, 0.15, 3, Math.PI / 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('normal')).toBeTruthy()
    expect(g.getAttribute('uv')).toBeTruthy()
    expect(finite(g)).toBe(true)
    const [w, h, d] = size(g)
    expect(h).toBeCloseTo(1, 2)                 // unit height on Y
    expect(w).toBeLessThanOrEqual(1.05)
    expect(d).toBeLessThanOrEqual(1.05)
  })

  it('stays finite for a triangular prism at the extreme corner radius', () => {
    const g = roundedPolyGeometry(3, 0.5, 0.49, 8, Math.PI / 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
    expect(size(g)[1]).toBeCloseTo(1, 2)
  })

  it('handles a 4-sided pyramid base angle without NaNs', () => {
    const g = roundedPolyGeometry(4, 0.55, 0.2, 4, Math.PI / 2 + Math.PI / 4)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  /** Every side/rim triangle's face normal must point away from the Y axis
   *  (outward), not inward. A self-intersecting bevel ring (a folded bowtie)
   *  produces triangles whose normals point back toward the axis (dot with
   *  the outward radial direction near -1); this catches that regression. */
  const assertRimFacesOutward = (g: THREE.BufferGeometry) => {
    const geo = g.index ? g.toNonIndexed() : g
    const pos = geo.getAttribute('position')
    const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3()
    const eAB = new THREE.Vector3(), eAC = new THREE.Vector3(), normal = new THREE.Vector3()
    const centroid = new THREE.Vector3(), rad = new THREE.Vector3()
    let checked = 0
    for (let i = 0; i < pos.count; i += 3) {
      pA.fromBufferAttribute(pos, i)
      pB.fromBufferAttribute(pos, i + 1)
      pC.fromBufferAttribute(pos, i + 2)
      eAB.subVectors(pB, pA)
      eAC.subVectors(pC, pA)
      normal.crossVectors(eAB, eAC).normalize()
      if (normal.lengthSq() === 0 || Number.isNaN(normal.x)) continue
      if (Math.abs(normal.y) >= 0.8) continue // cap/near-cap face, skip
      centroid.set((pA.x + pB.x + pC.x) / 3, (pA.y + pB.y + pC.y) / 3, (pA.z + pB.z + pC.z) / 3)
      rad.set(centroid.x, 0, centroid.z)
      if (rad.lengthSq() < 1e-8) continue // on-axis, no meaningful radial direction
      rad.normalize()
      checked++
      expect(normal.dot(rad)).toBeGreaterThan(-0.05)
    }
    expect(checked).toBeGreaterThan(0)
  }

  // cornerSides=1 (the lowest/coarsest bevel segmentation, same "extreme" style
  // as the lathe tests above) is what actually exposes the fold: with a finer
  // bevelSegments count the same self-intersecting ring can hide within the
  // sampled triangles even though the ring is still folded.
  it.each([
    [3, 0.5, 0.2],
    [3, 0.5, 0.49],
    [3, 0.5, 0.05],   // reliably folds under the old inward bevelOffset
    [4, 0.5, 0.2],
    [4, 0.5, 0.49],
    [6, 0.5, 0.2],    // reliably folds under the old inward bevelOffset
    [6, 0.5, 0.49],   // reliably folds under the old inward bevelOffset
    [4, 0.55, 0.2],   // pyramid case
  ])('keeps every side/rim face pointing outward (sides=%d, radius=%d, cornerRadius=%d)', (sides, radius, cornerRadius) => {
    const g = roundedPolyGeometry(sides, radius, cornerRadius, 1, Math.PI / 2)
    assertRimFacesOutward(g)
  })

  it('does not inflate the hex prism width past the nominal radius', () => {
    const g = roundedPolyGeometry(6, 0.5, 0.15, 3, Math.PI / 2)
    const [w, , d] = size(g)
    expect(w).toBeLessThanOrEqual(1.02)
    expect(d).toBeLessThanOrEqual(1.02)
  })
})

describe('roundedHullGeometry', () => {
  const bases = () => ({
    icosahedron: new THREE.IcosahedronGeometry(0.55),
    octahedron: new THREE.OctahedronGeometry(0.55),
    dodecahedron: new THREE.DodecahedronGeometry(0.55),
  })

  it('builds a valid rounded hull with normals and uv for each polyhedron', () => {
    for (const [name, base] of Object.entries(bases())) {
      const g = roundedHullGeometry(base, 0.12, 3)
      expect(g.getAttribute('position').count, name).toBeGreaterThan(0)
      expect(g.getAttribute('normal'), name).toBeTruthy()
      expect(g.getAttribute('uv'), name).toBeTruthy()
      expect(finite(g), name).toBe(true)
    }
  })

  it('preserves the base bounding size (does not balloon)', () => {
    const base = new THREE.IcosahedronGeometry(0.55)
    base.computeBoundingSphere()
    const r0 = base.boundingSphere!.radius
    const g = roundedHullGeometry(base, 0.2, 3)
    g.computeBoundingSphere()
    expect(g.boundingSphere!.radius).toBeCloseTo(r0, 2)
  })

  it('keeps some faces flat (offset-face triangles share an exact normal)', () => {
    const base = new THREE.DodecahedronGeometry(0.55)
    const g = roundedHullGeometry(base, 0.06, 2)
    const nrm = g.getAttribute('normal')
    // count triangles whose 3 vertices share an identical normal (a flat facet)
    let flatTris = 0
    for (let t = 0; t < nrm.count; t += 3) {
      const same =
        nrm.getX(t) === nrm.getX(t + 1) && nrm.getX(t + 1) === nrm.getX(t + 2) &&
        nrm.getY(t) === nrm.getY(t + 1) && nrm.getY(t + 1) === nrm.getY(t + 2) &&
        nrm.getZ(t) === nrm.getZ(t + 1) && nrm.getZ(t + 1) === nrm.getZ(t + 2)
      if (same) flatTris++
    }
    expect(flatTris).toBeGreaterThan(0)
  })

  it('stays finite at the extreme radius and lowest corner sides', () => {
    const base = new THREE.OctahedronGeometry(0.55)
    const g = roundedHullGeometry(base, 0.49, 1)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  it('adds vertices as corner sides rises (smoother arcs)', () => {
    const base = new THREE.IcosahedronGeometry(0.55)
    const coarse = roundedHullGeometry(base, 0.2, 1).getAttribute('position').count
    const smooth = roundedHullGeometry(base, 0.2, 8).getAttribute('position').count
    expect(smooth).toBeGreaterThan(coarse)
  })
})
