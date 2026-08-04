import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid } from '~/lib/scene3d/voxel/triGrid'
import { boundsOf } from '~/lib/scene3d/voxel/bounds'
import { buildSdf, latticeFor, unionLattice } from '~/lib/scene3d/voxel/sdf'

const sdfOf = (geo: THREE.BufferGeometry, res = 48) => {
  const grid = buildTriGrid(meshDataFromGeometry(geo), 2 / res)
  return buildSdf(grid, latticeFor(grid, res))
}

/** Reads the lattice node nearest a world coordinate. Throws rather than
 *  silently wrapping: without a bounds check, a coordinate outside the
 *  lattice produces an out-of-range flat index that JS array access still
 *  accepts, returning a plausible-looking value read from an unrelated
 *  interior node. That bit for real during Task 7 — a probe at (0.9, 0, 0)
 *  against a lattice only reaching to ~0.542 wrapped instead of failing, and
 *  was diagnosed only by noticing the returned value didn't make sense. */
const sample = (sdf: any, x: number, y: number, z: number) => {
  const i = Math.round((x - sdf.min[0]) / sdf.cell)
  const j = Math.round((y - sdf.min[1]) / sdf.cell)
  const k = Math.round((z - sdf.min[2]) / sdf.cell)
  const [nx, ny, nz] = sdf.dims
  if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) {
    throw new Error(
      `sample(${x}, ${y}, ${z}) -> node (${i}, ${j}, ${k}) is outside the lattice `
      + `(dims ${nx}x${ny}x${nz}, min [${sdf.min.join(', ')}], cell ${sdf.cell})`,
    )
  }
  return sdf.values[(k * ny + j) * nx + i]
}

describe('signed distance field', () => {
  it('signs a closed sphere: negative inside, positive outside', () => {
    const { sdf, open } = sdfOf(new THREE.SphereGeometry(0.5, 64, 48))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
    // Just outside the surface, not far outside: at res=48 with a 2-node
    // padding margin the lattice only reaches to ~0.542 from the sphere's
    // center (measured), so 0.9 lies off the sampled domain entirely and
    // sample()'s unchecked flat-index math wraps to an unrelated interior
    // node instead of erroring. 0.53 is outside the r=0.5 surface and inside
    // the lattice.
    expect(sample(sdf, 0.53, 0, 0)).toBeGreaterThan(0)
  })

  it('signs a closed box', () => {
    const { sdf, open } = sdfOf(new THREE.BoxGeometry(1, 1, 1))
    expect(open).toBe(false)
    expect(sample(sdf, 0, 0, 0)).toBeLessThan(0)
  })

  it('detects an open plane rather than producing garbage', () => {
    const { open } = sdfOf(new THREE.PlaneGeometry(1, 1))
    expect(open).toBe(true)
  })

  it('detects an open-ended cylinder', () => {
    const { open } = sdfOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true))
    expect(open).toBe(true)
  })

  it('detects a ring', () => {
    const { open } = sdfOf(new THREE.RingGeometry(0.22, 0.5, 48))
    expect(open).toBe(true)
  })

  it('does NOT call a thin closed shape open', () => {
    // A torus is closed but its interior is a small fraction of its bounding
    // box. An open test that compared interior against total VOLUME would call
    // this open; comparing against the surface band is what gets it right.
    // Same shape of case as a solidified plane (Task 9).
    const { open } = sdfOf(new THREE.TorusGeometry(0.4, 0.08, 24, 64), 64)
    expect(open).toBe(false)
  })

  it('signs a genuine surface-band node correctly on a closed sphere', () => {
    // Every other assertion in this file samples deep interior, well outside,
    // or just the `open` boolean. Nothing exercises sdf.ts:142-156, the
    // heuristic that signs a band node (unreached by both the flood fill and
    // a direct EXTERIOR neighbour) by the sign of its 6-neighbours.
    //
    // Ground truth needs care here: a UV-sphere's triangulated surface sags
    // relative to the ideal analytic sphere (vertices sit exactly on the
    // sphere, but face interiors are chords, strictly inside it) by an amount
    // that scales with lattice cell size, at every latitude — not just near
    // the poles. Measured directly at this resolution (64x48 segments, res
    // 48) the sag reaches ~0.23 cells; `ambiguous` below excludes a margin
    // well past that so only nodes with an unambiguous analytic sign are
    // asserted. (Ray-cast parity against the real mesh was also tried as an
    // independent oracle, and agreed with the SDF at every non-ambiguous node
    // checked, but has its own degeneracies at mesh vertices exactly on the
    // lattice's bounding box — e.g. the point nearest a sphere's extremum
    // along an axis — so the simpler, provably-sound analytic check with a
    // wide-enough margin is what's asserted here.)
    const radius = 0.5
    const { sdf } = sdfOf(new THREE.SphereGeometry(radius, 64, 48))
    const [nx, ny, nz] = sdf.dims
    const bandCut = sdf.cell * 0.75
    const ambiguous = sdf.cell * 0.4
    let checked = 0
    for (let k = 0; k < nz; k++) {
      const z = sdf.min[2] + k * sdf.cell
      for (let j = 0; j < ny; j++) {
        const y = sdf.min[1] + j * sdf.cell
        for (let i = 0; i < nx; i++) {
          const x = sdf.min[0] + i * sdf.cell
          const idx = (k * ny + j) * nx + i
          const value = sdf.values[idx]!
          if (Math.abs(value) >= bandCut) continue // not a band node
          const delta = Math.hypot(x, y, z) - radius
          if (Math.abs(delta) < ambiguous) continue // too close to the surface to arbitrate analytically
          checked++
          expect(Math.sign(value)).toBe(delta < 0 ? -1 : 1)
        }
      }
    }
    // Guards against the loop silently checking nothing (e.g. if bandCut or
    // the ambiguous margin were tightened until no node qualified).
    expect(checked).toBeGreaterThan(0)
  })

  it("sample() throws for a coordinate outside the lattice, rather than wrapping", () => {
    const { sdf } = sdfOf(new THREE.SphereGeometry(0.5, 64, 48))
    // The exact coordinate that silently wrapped during Task 7 (see the
    // helper's own comment): outside the lattice, which only reaches ~0.542.
    expect(() => sample(sdf, 0.9, 0, 0)).toThrow(/outside the lattice/)
  })
})

describe('unionLattice', () => {
  it('covers every input mesh, not just one', () => {
    // Two spheres translated apart along X so their bounds do not overlap.
    const geoA = new THREE.SphereGeometry(0.3, 32, 24).translate(-2, 0, 0)
    const geoB = new THREE.SphereGeometry(0.3, 32, 24).translate(2, 0, 0)
    const gridA = buildTriGrid(meshDataFromGeometry(geoA), 2 / 48)
    const gridB = buildTriGrid(meshDataFromGeometry(geoB), 2 / 48)

    const lattice = unionLattice([gridA, gridB], 48)
    const latHi: [number, number, number] = [0, 1, 2].map(
      a => lattice.min[a]! + (lattice.dims[a]! - 1) * lattice.cell,
    ) as [number, number, number]

    for (const grid of [gridA, gridB]) {
      const { lo, hi } = boundsOf(grid.data)
      for (let a = 0; a < 3; a++) {
        expect(lattice.min[a]!).toBeLessThanOrEqual(lo[a]!)
        expect(latHi[a]!).toBeGreaterThanOrEqual(hi[a]!)
      }
    }
  })

  it('returns a degenerate-but-finite lattice for an empty input, not Infinity dims', () => {
    const lattice = unionLattice([], 48)
    expect(Number.isFinite(lattice.cell)).toBe(true)
    expect(lattice.min.every(v => Number.isFinite(v))).toBe(true)
    expect(lattice.dims.every(d => Number.isFinite(d) && d > 0)).toBe(true)
  })

  it('matches latticeFor when given a single input', () => {
    const geo = new THREE.SphereGeometry(0.5, 64, 48)
    const grid = buildTriGrid(meshDataFromGeometry(geo), 2 / 48)

    const viaUnion = unionLattice([grid], 48)
    const viaLatticeFor = latticeFor(grid, 48)

    expect(viaUnion).toEqual(viaLatticeFor)
  })
})
