import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { sunDirection, geometryFor, baseSizeFor, buildGeometry, lightFor, SceneEngine } from '~/lib/scene3d/engine'
import { PRIMITIVE_KINDS, createPrimitive, createLight, type PrimitiveKind, type PrimitiveObject } from '~/lib/scene3d/config'
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

  it('rounds the rim of a cylinder and keeps its footprint', () => {
    const plain = geometryFor('cylinder')
    const round = geometryFor('cylinder', { cornerRadius: 0.2, cornerSides: 3 })
    expect(round.getAttribute('position').count).not.toBe(plain.getAttribute('position').count)
    const [w, h, d] = sizeOf(round)
    expect(h).toBeLessThanOrEqual(1.0001)
    expect(Math.max(w, d)).toBeCloseTo(1, 1)
  })

  it('rounds the edges of a prism into a valid faceted solid', () => {
    const round = geometryFor('prism', { detail: 6, cornerRadius: 0.15, cornerSides: 3 })
    expect(round.getAttribute('position').count).toBeGreaterThan(0)
    expect(sizeOf(round)[1]).toBeCloseTo(1, 1)
  })

  it('keeps cylinder/cone/prism/pyramid identical at cornerRadius 0', () => {
    for (const kind of ['cylinder', 'cone', 'prism', 'pyramid'] as const) {
      const a = geometryFor(kind).getAttribute('position').count
      const b = geometryFor(kind, { cornerRadius: 0 }).getAttribute('position').count
      expect(b, kind).toBe(a)
    }
  })

  it('rounds the polyhedra edges and preserves their footprint', () => {
    for (const kind of ['icosahedron', 'octahedron', 'dodecahedron'] as const) {
      const plain = geometryFor(kind)
      const round = geometryFor(kind, { cornerRadius: 0.15, cornerSides: 3 })
      expect(round.getAttribute('position').count, kind).toBeGreaterThan(0)
      expect(round.getAttribute('uv'), `${kind} uv`).toBeTruthy()
      // The rounded hull is a convex hull with flat faces + rounded edges/corners,
      // which produces substantially more triangles than the plain polyhedron. If
      // the rounding wiring were absent (factory falling back to the plain
      // geometry at cornerRadius > 0), this would fail.
      expect(round.getAttribute('position').count, `${kind} should have more geometry when rounded`)
        .toBeGreaterThan(plain.getAttribute('position').count)
      // size preserved within a small tolerance
      plain.computeBoundingSphere(); round.computeBoundingSphere()
      expect(round.boundingSphere!.radius, kind).toBeCloseTo(plain.boundingSphere!.radius, 1)
    }
  })

  it('keeps the polyhedra identical at cornerRadius 0', () => {
    for (const kind of ['icosahedron', 'octahedron', 'dodecahedron'] as const) {
      const a = geometryFor(kind).getAttribute('position').count
      const b = geometryFor(kind, { cornerRadius: 0 }).getAttribute('position').count
      expect(b, kind).toBe(a)
    }
  })
})

describe('scene3d facet geometry variant', () => {
  it('leaves the smooth variant untouched', () => {
    const geo = buildGeometry('box', { cornerRadius: 0.2 }, undefined, 'smooth')
    expect(geo.getAttribute('aFaceMin')).toBeUndefined()
    expect(geo.getAttribute('aFaceMax')).toBeUndefined()
  })

  // The facet gradient reads aFaceMin/aFaceMax to ramp across each face. A
  // PARAMETER edit rebuilds the geometry through this same step, so the
  // attributes must come back on non-default params too — not just on a
  // smooth↔facet flip.
  it.each([
    ['box', { cornerRadius: 0.25, cornerSides: 4 }],
    ['prism', { detail: 6 }],
    ['torus', { tube: 0.3, detail: 24 }],
    ['sphere', { detail: 12 }],
  ] as const)('bakes face extents after a %s param rebuild', (kind, params) => {
    const geo = buildGeometry(kind, params as Record<string, number>, undefined, 'facet')
    const pos = geo.getAttribute('position')
    const min = geo.getAttribute('aFaceMin')
    const max = geo.getAttribute('aFaceMax')

    expect(geo.index).toBeNull() // facet variant is always non-indexed
    expect(min.itemSize).toBe(3)
    expect(max.itemSize).toBe(3)
    expect(min.count).toBe(pos.count)
    expect(max.count).toBe(pos.count)

    for (let v = 0; v < pos.count; v += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const lo = min.getComponent(v, axis)
        const hi = max.getComponent(v, axis)
        expect(lo).toBeLessThanOrEqual(hi)
        // Same value on all 3 verts of the face, and it brackets each vertex.
        for (let k = 0; k < 3; k++) {
          expect(min.getComponent(v + k, axis)).toBe(lo)
          expect(max.getComponent(v + k, axis)).toBe(hi)
          const c = pos.getComponent(v + k, axis)
          expect(c).toBeGreaterThanOrEqual(lo)
          expect(c).toBeLessThanOrEqual(hi)
        }
      }
    }
  })

  it('tracks the param change in the baked extents', () => {
    const spanX = (p: Record<string, number>): number => {
      const a = buildGeometry('torus', p, undefined, 'facet').getAttribute('aFaceMax')
      let m = -Infinity
      for (let i = 0; i < a.count; i++) m = Math.max(m, a.getComponent(i, 0))
      return m
    }
    expect(spanX({ tube: 0.4 })).toBeGreaterThan(spanX({ tube: 0.05 }))
  })
})

describe('scene3d engine modifier integration', () => {
  it('builds undeformed geometry when no modifiers are set', () => {
    const plain = buildGeometry('box', undefined, undefined, 'smooth')
    const alsoPlain = buildGeometry('box', undefined, {}, 'smooth')
    expect(alsoPlain.getAttribute('position').count).toBe(plain.getAttribute('position').count)
  })

  it('applies modifiers to the built geometry', () => {
    const plain = buildGeometry('box', undefined, undefined, 'smooth')
    const arrayed = buildGeometry('box', undefined, { cloneCount: 3 }, 'smooth')
    expect(arrayed.getAttribute('position').count).toBe(plain.getAttribute('position').count * 3)
  })

  it('still produces face extents for the faceted variant after deformation', () => {
    const g = buildGeometry('box', undefined, { twist: 90, subdivide: 1 }, 'facet')
    expect(g.getAttribute('aFaceMin')).toBeTruthy()
    expect(g.getAttribute('aFaceMax')).toBeTruthy()
    expect(g.getAttribute('aFaceMin').count).toBe(g.getAttribute('position').count)
  })

  it('reports base size including modifiers', () => {
    const plain = baseSizeFor('box')
    const arrayed = baseSizeFor('box', undefined, { cloneCount: 3, cloneOffsetX: 2 })
    expect(arrayed[0]).toBeGreaterThan(plain[0])
  })
})

// syncObject needs a live WebGL context to reach through SceneEngine's
// constructor (WebGLRenderer + PMREM), which jsdom has no way to provide. The
// method itself only touches objectRoots / scene / glbTokens, so the deferral
// behaviour is exercised against a stand-in `this` — the real prototype method,
// no reimplementation.
describe('scene3d engine deferred geometry', () => {
  const objectFor = (detail: number): PrimitiveObject => ({
    ...createPrimitive('sphere', []),
    params: { detail },
    modifiers: { cloneCountX: 3, cloneCountY: 3, cloneCountZ: 3 },
  })
  const makeHost = () => ({
    objectRoots: new Map<string, THREE.Object3D>(),
    glbTokens: new Map<string, number>(),
    token: 0,
    deferGeometry: false,
    scene: { add() {}, remove() {} },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sync = (host: any, obj: PrimitiveObject) => (SceneEngine.prototype as any).syncObject.call(host, obj)

  it('rebuilds geometry on a param change when not deferring', () => {
    const host = makeHost()
    const obj = objectFor(16)
    sync(host, obj)
    const mesh = host.objectRoots.get(obj.id) as THREE.Mesh
    const before = mesh.geometry.getAttribute('position').count
    sync(host, { ...obj, params: { detail: 48 } })
    expect(mesh.geometry.getAttribute('position').count).not.toBe(before)
  })

  it('skips the rebuild while deferring, and leaves the stale key so release catches up', () => {
    const host = makeHost()
    const obj = objectFor(16)
    sync(host, obj)
    const mesh = host.objectRoots.get(obj.id) as THREE.Mesh
    const before = mesh.geometry.getAttribute('position').count
    const keyBefore = mesh.userData.geoKey

    host.deferGeometry = true
    sync(host, { ...obj, params: { detail: 32 } })
    sync(host, { ...obj, params: { detail: 48 } })
    expect(mesh.geometry.getAttribute('position').count).toBe(before)
    expect(mesh.userData.geoKey).toBe(keyBefore) // stale on purpose

    host.deferGeometry = false
    sync(host, { ...obj, params: { detail: 48 } })
    const finalCount = mesh.geometry.getAttribute('position').count
    expect(finalCount).not.toBe(before)
    // The catch-up build matches the final slider value exactly, not an
    // intermediate one from during the drag.
    expect(finalCount).toBe(
      buildGeometry('sphere', { detail: 48 }, obj.modifiers, 'smooth').getAttribute('position').count,
    )
  })

  it('keeps transform, visibility and material live while deferring', () => {
    const host = makeHost()
    const obj = objectFor(16)
    sync(host, obj)
    const mesh = host.objectRoots.get(obj.id) as THREE.Mesh

    host.deferGeometry = true
    sync(host, {
      ...obj,
      params: { detail: 48 },
      position: [1, 2, 3],
      visible: false,
      material: { ...obj.material, color: '#ff0000' },
    })
    expect(mesh.position.toArray()).toEqual([1, 2, 3])
    expect(mesh.visible).toBe(false)
    expect((mesh.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('ff0000')
  })
})

describe('scene3d light factory', () => {
  it('maps each light kind to the right THREE light with its params', () => {
    const point = lightFor(createLight('point', []))
    expect(point).toBeInstanceOf(THREE.PointLight)
    const spotObj = createLight('spot', []); spotObj.angle = 0.5; spotObj.penumbra = 0.4
    const spot = lightFor(spotObj) as THREE.SpotLight
    expect(spot).toBeInstanceOf(THREE.SpotLight)
    expect(spot.angle).toBeCloseTo(0.5)
    expect(spot.penumbra).toBeCloseTo(0.4)
    const rect = lightFor(createLight('rect', []))
    expect(rect).toBeInstanceOf(THREE.RectAreaLight)
  })

  it('applies color and intensity', () => {
    const o = createLight('point', []); o.color = '#ff0000'; o.intensity = 3.5
    const l = lightFor(o) as THREE.PointLight
    expect(l.color.getHexString()).toBe('ff0000')
    expect(l.intensity).toBe(3.5)
  })
})
