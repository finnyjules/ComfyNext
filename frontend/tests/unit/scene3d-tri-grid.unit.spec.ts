import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { buildTriGrid, closestDistance, raycastGrid } from '~/lib/scene3d/voxel/triGrid'

const sphereGrid = (cell = 0.05) =>
  buildTriGrid(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 64, 48)), cell)

describe('triangle grid', () => {
  it('measures distance to a unit sphere surface analytically', () => {
    const g = sphereGrid()
    // A point on the +X axis at r=0.8 is 0.3 from a sphere of radius 0.5.
    expect(closestDistance(g, 0.8, 0, 0, 2)).toBeCloseTo(0.3, 2)
    // Dead centre is 0.5 from the surface.
    expect(closestDistance(g, 0, 0, 0, 2)).toBeCloseTo(0.5, 2)
  })

  it('returns the search radius when nothing is within it', () => {
    const g = sphereGrid()
    expect(closestDistance(g, 50, 50, 50, 1)).toBe(1)
  })

  it('raycasts onto the surface at the analytic distance', () => {
    const g = sphereGrid()
    const hit = raycastGrid(g, [3, 0, 0], [-1, 0, 0])
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(2.5, 2) // 3 - 0.5
  })

  it('misses cleanly when the ray passes by', () => {
    const g = sphereGrid()
    expect(raycastGrid(g, [3, 5, 0], [-1, 0, 0])).toBeNull()
  })

  // The sphere above is tessellated finely enough (64x48) that every probe
  // above lands in pointTriDistSq's FACE-INTERIOR region. A single hand-built
  // triangle lets us put a probe in each of the other 6 regions (3 vertex, 3
  // edge) too. Expected distances below are computed independently, by
  // decomposing the query into "closest point on each of the 3 line segments
  // AB/BC/CA, take the minimum" — never via the vb/vc/va formulas the
  // implementation itself uses, so a broken region condition can't happen to
  // reproduce the same wrong answer as the expectation.
  describe('pointTriDistSq: all 7 regions on a hand-built triangle', () => {
    // Right triangle in the XY plane: A=(0,0,0), B=(1,0,0), C=(0,1,0).
    const triangleGrid = () => {
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
      const indices = new Uint32Array([0, 1, 2])
      return buildTriGrid({ positions, indices }, 0.1)
    }

    it('beyond vertex A', () => {
      const g = triangleGrid()
      // P=(-1,-1,0): projecting onto segment AB (the x-axis, x in [0,1])
      // clamps to x=0 (A); projecting onto segment CA (the y-axis, y in
      // [0,1]) clamps to y=0 (A) too. Both edges' nearest point is A, and
      // segment BC's foot (s=0.5, well inside [0,1]) is at (0.5,0.5), which
      // is sqrt(1.5^2+1.5^2)=sqrt(4.5)~=2.121 away — farther. So the overall
      // closest point is A=(0,0,0).
      // distance = |P - A| = sqrt(1^2 + 1^2) = sqrt(2)
      expect(closestDistance(g, -1, -1, 0, 3)).toBeCloseTo(Math.sqrt(2), 5)
    })

    it('beyond vertex B', () => {
      const g = triangleGrid()
      // P=(2,-0.5,0): projecting onto AB clamps to x=1 (B), since x=2 is
      // past the segment's end. Projecting onto BC (param s = BP.(C-B)/|C-B|^2
      // = ((-1)(1)+(1)(-0.5))/2 = -0.75, clamped to s=0) also lands on B.
      // Segment CA's foot clamps to A, at sqrt(2^2+0.5^2)=sqrt(4.25)~=2.062 —
      // farther. So the overall closest point is B=(1,0,0).
      // distance = |P - B| = sqrt(1^2 + 0.5^2) = sqrt(1.25)
      expect(closestDistance(g, 2, -0.5, 0, 3)).toBeCloseTo(Math.sqrt(1.25), 5)
    })

    it('beyond vertex C', () => {
      const g = triangleGrid()
      // P=(-0.5,2,0) is the vertex-B case mirrored across the AB<->CA,
      // B<->C symmetry of this right triangle.
      // distance = |P - C| = sqrt(0.5^2 + 1^2) = sqrt(1.25)
      expect(closestDistance(g, -0.5, 2, 0, 3)).toBeCloseTo(Math.sqrt(1.25), 5)
    })

    it('nearest edge AB, not a vertex', () => {
      const g = triangleGrid()
      // P=(0.5,-1,0) sits below the midpoint of AB (x=0.5 is the middle of
      // [0,1], well clear of either endpoint). The foot of the perpendicular
      // onto the segment is (0.5,0,0) — an interior point of AB, not a
      // vertex — so distance is just the perpendicular offset.
      // distance = |dy| = 1
      expect(closestDistance(g, 0.5, -1, 0, 3)).toBeCloseTo(1, 5)
    })

    it('nearest edge CA, not a vertex', () => {
      const g = triangleGrid()
      // P=(-1,0.5,0), the AB case mirrored across x<->y. Foot = (0,0.5,0).
      // distance = |dx| = 1
      expect(closestDistance(g, -1, 0.5, 0, 3)).toBeCloseTo(1, 5)
    })

    it('nearest edge BC, not a vertex', () => {
      const g = triangleGrid()
      // Midpoint of BC is M=(0.5,0.5,0). The outward unit normal to BC in
      // the z=0 plane is n=(1,1,0)/sqrt(2) (perpendicular to BC's direction
      // (-1,1,0), pointing away from A). Offsetting M by 1 unit along n
      // gives a point whose perpendicular foot on the *line* BC is M itself
      // (the offset is pure perpendicular motion), and M sits at BC's
      // parameter s=0.5 — the middle of the segment, not an endpoint.
      // distance = 1, by construction (a unit offset along the normal)
      const off = 1 / Math.sqrt(2)
      expect(closestDistance(g, 0.5 + off, 0.5 + off, 0, 3)).toBeCloseTo(1, 5)
    })

    it('above the face interior', () => {
      const g = triangleGrid()
      // The centroid (1/3,1/3,0) has barycentric coordinates (1/3,1/3,1/3) —
      // equidistant in barycentric terms from all 3 edges, comfortably
      // inside the face. Directly above it, the closest point on the
      // triangle is the straight-down projection, so the answer is just the
      // perpendicular (z) offset, independent of the in-plane position.
      // distance = z = 1
      expect(closestDistance(g, 1 / 3, 1 / 3, 1, 3)).toBeCloseTo(1, 5)
    })
  })

  it('raycasts across several empty cells at an angle before hitting', () => {
    // A triangle tilted across all 3 axes, A=(0,0,0), B=(6,0,0), C=(0,6,6),
    // so the grid's bounding box (and hence the DDA's cell walk) has real
    // extent in x, y and z alike — unlike the single-axis sphere hit above.
    const positions = new Float32Array([0, 0, 0, 6, 0, 0, 0, 6, 6])
    const indices = new Uint32Array([0, 1, 2])
    const g = buildTriGrid({ positions, indices }, 0.3)

    // The centroid is ((0+6+0)/3, (0+0+6)/3, (0+0+6)/3) = (2,2,2) —
    // barycentric (1/3,1/3,1/3), safely inside the triangle. Aim a ray at it
    // from well outside the grid, along a direction that is not axis-aligned
    // and has no two components tied to the exact same value as the box
    // extent, so the DDA must step through several empty cells (at 0.3 per
    // cell against a ~7-unit approach, several dozen candidate steps) before
    // the current cell happens to contain the hit.
    const origin: [number, number, number] = [-5, -5, -8]
    const dir: [number, number, number] = [7, 7, 10] // centroid - origin, unnormalized
    const hit = raycastGrid(g, origin, dir)
    expect(hit).not.toBeNull()
    // distance = |centroid - origin| = |(7,7,10)| = sqrt(7^2+7^2+10^2) = sqrt(198)
    expect(hit!.t).toBeCloseTo(Math.sqrt(198), 2)
  })
})
