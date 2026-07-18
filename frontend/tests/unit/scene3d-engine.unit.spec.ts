import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { sunDirection, geometryFor, baseSizeFor } from '~/lib/scene3d/engine'
import { PRIMITIVE_KINDS, type PrimitiveKind } from '~/lib/scene3d/config'
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'

describe('scene3d sun direction', () => {
  it('points straight up at 90° elevation', () => {
    const [x, y, z] = sunDirection(0, 90)
    expect(y).toBeCloseTo(1)
    expect(Math.hypot(x, z)).toBeCloseTo(0)
  })
  it('is a unit vector at arbitrary angles', () => {
    const [x, y, z] = sunDirection(123, 34)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
    expect(y).toBeCloseTo(Math.sin((34 * Math.PI) / 180))
  })
})

const sizeOf = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}

describe('scene3d parametric geometry', () => {
  // The pre-parametric calls are the oracle: at default params the factory must
  // still produce exactly these meshes, so old scenes render unchanged.
  const ORIGINALS: Record<PrimitiveKind, () => THREE.BufferGeometry> = {
    box: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 48, 32),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
    cone: () => new THREE.ConeGeometry(0.5, 1, 48),
    torus: () => new THREE.TorusGeometry(0.5, 0.18, 24, 64),
    plane: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    capsule: () => new THREE.CapsuleGeometry(0.35, 0.5, 8, 24),
    pyramid: () => new THREE.ConeGeometry(0.55, 1, 4, 1).rotateY(Math.PI / 4),
    prism: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 3),
    icosahedron: () => new THREE.IcosahedronGeometry(0.55),
    octahedron: () => new THREE.OctahedronGeometry(0.55),
    dodecahedron: () => new THREE.DodecahedronGeometry(0.55),
    torusKnot: () => new THREE.TorusKnotGeometry(0.4, 0.12, 128, 16),
    ring: () => new THREE.RingGeometry(0.22, 0.5, 48).rotateX(-Math.PI / 2),
  }

  it('reproduces the pre-parametric geometry at default params', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const got = geometryFor(kind)
      const want = ORIGINALS[kind]()
      expect(got.getAttribute('position').count, `${kind} vertex count`)
        .toBe(want.getAttribute('position').count)
      const [gx, gy, gz] = sizeOf(got)
      const [wx, wy, wz] = sizeOf(want)
      expect(gx, `${kind} width`).toBeCloseTo(wx, 5)
      expect(gy, `${kind} height`).toBeCloseTo(wy, 5)
      expect(gz, `${kind} depth`).toBeCloseTo(wz, 5)
    }
  })

  it('builds every kind at both ends of every parameter range', () => {
    // Guards against a param wired to a three.js argument that rejects its own
    // extreme (a 0-segment ring, a degenerate radius) — each must still build.
    for (const kind of PRIMITIVE_KINDS) {
      for (const spec of PRIMITIVE_PARAMS[kind]) {
        for (const v of [spec.min, spec.max]) {
          const g = geometryFor(kind, { [spec.key]: v })
          expect(g.getAttribute('position').count, `${kind}.${spec.key}=${v}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('drives the side count of radial shapes from detail', () => {
    const hex = geometryFor('cylinder', { detail: 6 })
    const many = geometryFor('cylinder', { detail: 48 })
    expect(hex.getAttribute('position').count).toBeLessThan(many.getAttribute('position').count)
    // A 6-sided cylinder is a hexagonal prism. Three starts its ring at +Z, so
    // the hexagon spans the full diameter on Z and only flat-to-flat (0.866) on
    // X — narrower than the 1.0 circumscribed diameter of the smooth one.
    expect(sizeOf(hex)[0]).toBeLessThan(sizeOf(many)[0])
  })

  it('rounds the box corners and keeps its overall size', () => {
    const plain = geometryFor('box')
    const round = geometryFor('box', { cornerRadius: 0.2, cornerSides: 4 })
    expect(round.getAttribute('position').count).toBeGreaterThan(plain.getAttribute('position').count)
    const [w, h, d] = sizeOf(round)
    expect(w).toBeCloseTo(1, 3)
    expect(h).toBeCloseTo(1, 3)
    expect(d).toBeCloseTo(1, 3)
  })

  it('cuts a partial sweep with arc', () => {
    const full = geometryFor('torus')
    const half = geometryFor('torus', { arc: 180 })
    // The torus sweeps in XY from +X: half of it keeps the full X span but
    // loses the lower half of its Y span.
    expect(sizeOf(half)[1]).toBeLessThan(sizeOf(full)[1])
  })

  it('subdivides the polyhedra toward a sphere', () => {
    const flat = geometryFor('icosahedron')
    const smooth = geometryFor('icosahedron', { detail: 2 })
    expect(smooth.getAttribute('position').count).toBeGreaterThan(flat.getAttribute('position').count)
  })

  it('reports unscaled base dimensions', () => {
    const [w, h, d] = baseSizeFor('box')
    expect(w).toBeCloseTo(1)
    expect(h).toBeCloseTo(1)
    expect(d).toBeCloseTo(1)
    // A fatter tube makes the whole torus bigger, so Size must follow params.
    expect(baseSizeFor('torus', { tube: 0.4 })[0])
      .toBeGreaterThan(baseSizeFor('torus', { tube: 0.05 })[0])
  })
})
