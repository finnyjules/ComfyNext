import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry } from '~/lib/scene3d/mesh'
import { SculptSession } from '~/lib/scene3d/sculpt/session'
import { applyBrush, falloff, type BrushKind, type BrushStamp } from '~/lib/scene3d/sculpt/brushes'

/** A flat patch in the XZ plane, normal +Y, centred on the origin. */
const patch = () => {
  const geo = new THREE.PlaneGeometry(2, 2, 24, 24).rotateX(-Math.PI / 2)
  return new SculptSession(meshDataFromGeometry(geo))
}
const sphere = () =>
  new SculptSession(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32)))

const stamp = (over: Partial<BrushStamp> = {}): BrushStamp => ({
  centre: [0, 0, 0], normal: [0, 1, 0], radius: 0.4, strength: 0.5, invert: false, ...over,
})

/** Index of the vertex nearest a point. */
const nearest = (s: SculptSession, x: number, y: number, z: number): number => {
  let best = -1, bestD = Infinity
  for (let v = 0; v < s.positions.length / 3; v++) {
    const d = Math.hypot(s.positions[v * 3]! - x, s.positions[v * 3 + 1]! - y, s.positions[v * 3 + 2]! - z)
    if (d < bestD) { bestD = d; best = v }
  }
  return best
}
const y = (s: SculptSession, v: number) => s.positions[v * 3 + 1]!

describe('falloff', () => {
  it('is 1 at the centre, 0 at the rim, and monotonic between', () => {
    expect(falloff(0)).toBeCloseTo(1, 6)
    expect(falloff(1)).toBe(0)
    expect(falloff(1.5)).toBe(0)
    expect(falloff(0.3)).toBeGreaterThan(falloff(0.7))
  })
})

describe('draw brush', () => {
  it('pushes along the stamp normal', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    s.beginStroke(); applyBrush(s, 'draw', stamp()); s.endStroke()
    expect(y(s, v)).toBeGreaterThan(0)
  })

  it('carves the other way when inverted', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    s.beginStroke(); applyBrush(s, 'draw', stamp({ invert: true })); s.endStroke()
    expect(y(s, v)).toBeLessThan(0)
  })

  it('moves the centre more than the rim, and outside the radius not at all', () => {
    const s = patch()
    const centre = nearest(s, 0, 0, 0)
    const mid = nearest(s, 0.32, 0, 0)     // 80% of the radius
    const outside = nearest(s, 0.9, 0, 0)  // beyond it
    s.beginStroke(); applyBrush(s, 'draw', stamp()); s.endStroke()
    expect(y(s, centre)).toBeGreaterThan(y(s, mid))
    expect(y(s, mid)).toBeGreaterThan(0)
    expect(y(s, outside)).toBeCloseTo(0, 6)
  })
})

describe('undo', () => {
  it('is exact for every brush kind, not just draw', () => {
    // The four kinds share one loop, but each has its own displacement branch
    // (see applyBrush) and `smooth`/`flatten` also gather a pre-pass before the
    // loop. `recordVertex` ordering could regress in any one branch without
    // the others noticing, so assert restoration for all four rather than
    // treating `draw` as a stand-in for the rest.
    const kinds: BrushKind[] = ['draw', 'smooth', 'inflate', 'flatten']
    for (const kind of kinds) {
      const s = patch()
      // Give smooth/flatten a spike to pull toward, so their branches actually
      // move something (a perfectly flat patch is already its own average).
      const v = nearest(s, 0, 0, 0)
      s.positions[v * 3 + 1] = 0.1
      const before = s.positions.slice()

      s.beginStroke()
      applyBrush(s, kind, stamp({ strength: 1 }))
      s.endStroke()
      expect(s.positions, `${kind} should have moved something`).not.toEqual(before)

      expect(s.undo(), `${kind} undo`).toBe(true)
      expect(s.positions, `${kind} restores exactly`).toEqual(before)
    }
  })
})

describe('inflate brush', () => {
  it('moves each vertex along its OWN normal, not the stamp normal', () => {
    // On a sphere, the top and bottom of the brush region face opposite ways.
    // An implementation that used the stamp normal for every vertex would move
    // them the same direction and fail this.
    const s = sphere()
    const top = nearest(s, 0, 0.5, 0)
    const bottom = nearest(s, 0, -0.5, 0)
    const y0 = y(s, top), y1 = y(s, bottom)
    s.beginStroke()
    applyBrush(s, 'inflate', stamp({ centre: [0, 0.5, 0], radius: 5, strength: 0.5 }))
    s.endStroke()
    expect(y(s, top)).toBeGreaterThan(y0)     // pushed up, out of the sphere
    expect(y(s, bottom)).toBeLessThan(y1)     // pushed down, also out
  })
})

describe('smooth brush', () => {
  it('pulls a spike back toward its neighbours', () => {
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    // A spike small enough to stay within the default stamp radius (0.4) —
    // verticesNear is a live 3D-distance query, so a spike taller than the
    // radius would put the vertex outside the brush's own reach and this
    // test could never pass under any correct implementation.
    s.positions[v * 3 + 1] = 0.1
    const before = y(s, v)
    s.beginStroke(); applyBrush(s, 'smooth', stamp({ strength: 1 })); s.endStroke()
    expect(y(s, v)).toBeLessThan(before)
    expect(y(s, v)).toBeGreaterThan(0) // toward the neighbours, not past them
  })

  it('averages DISTINCT neighbours, not the duplicate-laden list `neighboursOf` returns', () => {
    // `neighboursOf` lists one entry per incident triangle, so a vertex shared
    // by several triangles appears several times. Three triangles fan out from
    // vertex 0 through vertex 1 (giving vertex 1 a valence of 3 in the raw
    // list) to three other, unshared vertices (valence 1 each):
    //   (0,1,2) (0,1,3) (0,1,4)
    // Averaging the raw list naively over-weights vertex 1 and pulls vertex 0
    // toward x = 1/3 instead of the true uniform average of {1,2,3,4}, x = 0.
    const positions = new Float32Array([
      5, 0, 0, // v0 — to be smoothed, far along +x so the pull is unambiguous
      1, 0, 0, // v1 — shared by all three triangles
      -1, 0, 0, // v2
      0, 1, 0, // v3
      0, -1, 0, // v4
    ])
    const indices = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 1, 4])
    const s = new SculptSession({ positions, indices })

    // Sanity-check the defect is actually present in this fixture.
    const nb = Array.from(s.neighboursOf(0))
    expect(nb.length).toBe(6)
    expect(nb.filter((n) => n === 1).length).toBe(3)

    s.beginStroke()
    applyBrush(s, 'smooth', stamp({ centre: [5, 0, 0], radius: 1, strength: 1 }))
    s.endStroke()

    // Deduped uniform average of {v1..v4} is (0,0,0) on x; the duplicate-
    // weighted average would land at x ≈ 0.333 instead.
    expect(s.positions[0]!).toBeCloseTo(0, 6)
  })
})

describe('applyBrush safety', () => {
  it('does not write NaN when radius is 0 and a vertex sits exactly on the stamp centre', () => {
    // verticesNear's r2 test (`dx*dx+dy*dy+dz*dz <= r2`) passes on exact
    // coincidence even when r2 is 0, so a zero-radius stamp centred exactly on
    // a vertex still returns a hit. `falloff(d / stamp.radius)` then computes
    // `0 / 0` for that vertex — NaN — which must not reach `positions`.
    const s = patch()
    const v = nearest(s, 0, 0, 0)
    expect(s.positions[v * 3]).toBe(0)
    expect(s.positions[v * 3 + 1]).toBe(0)
    expect(s.positions[v * 3 + 2]).toBe(0)

    s.beginStroke()
    applyBrush(s, 'draw', stamp({ radius: 0 }))
    s.endStroke()

    for (let i = 0; i < s.positions.length; i++) {
      expect(Number.isNaN(s.positions[i])).toBe(false)
    }
  })
})

describe('flatten brush', () => {
  it('reduces the spread of a bumpy region', () => {
    const s = patch()
    const inRange = s.verticesNear(0, 0, 0, 0.4)
    for (let n = 0; n < inRange.length; n++) {
      s.positions[inRange[n]! * 3 + 1] = (n % 2 === 0 ? 0.2 : -0.2)
    }
    const spread = (): number => {
      const vals: number[] = []
      for (let n = 0; n < inRange.length; n++) vals.push(y(s, inRange[n]!))
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
    }
    const before = spread()
    s.beginStroke(); applyBrush(s, 'flatten', stamp({ strength: 1 })); s.endStroke()
    expect(spread()).toBeLessThan(before)
  })
})

describe('pinch brush', () => {
  it('pulls vertices toward the stamp centre', () => {
    const s = patch()
    const inRange = s.verticesNear(0, 0, 0, 0.4)
    const meanDist = (): number => {
      let sum = 0
      for (let n = 0; n < inRange.length; n++) {
        const v = inRange[n]!
        sum += Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 1]!, s.positions[v * 3 + 2]!)
      }
      return sum / inRange.length
    }
    const before = meanDist()
    s.beginStroke(); applyBrush(s, 'pinch', stamp({ strength: 0.5 })); s.endStroke()
    expect(meanDist()).toBeLessThan(before)
  })
})

describe('crease brush', () => {
  it('pinches AND displaces — an implementation doing only one fails', () => {
    const s = patch()
    const v = nearest(s, 0.2, 0, 0)
    const rBefore = Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 2]!)
    s.beginStroke(); applyBrush(s, 'crease', stamp({ strength: 0.5, invert: true })); s.endStroke()
    const rAfter = Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 2]!)
    expect(rAfter).toBeLessThan(rBefore)      // the pinch half
    expect(y(s, v)).toBeLessThan(0)           // the displace half (inverted = cut in)
  })
})

describe('grab brush', () => {
  it('translates by the drag, ignoring normals entirely', () => {
    // On a sphere, top and bottom face opposite ways. Every other brush would
    // move them in opposite directions; grab must move both the SAME way.
    const s = sphere()
    const top = nearest(s, 0, 0.5, 0)
    const bottom = nearest(s, 0, -0.5, 0)
    const beforeTop = s.positions[top * 3]!
    const beforeBottom = s.positions[bottom * 3]!
    s.beginStroke()
    applyBrush(s, 'grab', stamp({ centre: [0, 0, 0], radius: 5, strength: 1, drag: [0.1, 0, 0] }))
    s.endStroke()
    expect(s.positions[top * 3]!).toBeGreaterThan(beforeTop)
    expect(s.positions[bottom * 3]!).toBeGreaterThan(beforeBottom)
  })

  it('does nothing without a drag', () => {
    const s = patch()
    const before = s.positions.slice()
    s.beginStroke(); applyBrush(s, 'grab', stamp()); s.endStroke()
    expect(s.positions).toEqual(before)
  })

  it('falls off from the centre like every other brush', () => {
    const s = patch()
    const centre = nearest(s, 0, 0, 0)
    const rim = nearest(s, 0.35, 0, 0)
    const c0 = s.positions[centre * 3]!, r0 = s.positions[rim * 3]!
    s.beginStroke()
    applyBrush(s, 'grab', stamp({ strength: 1, drag: [0.1, 0, 0] }))
    s.endStroke()
    expect(s.positions[centre * 3]! - c0).toBeGreaterThan(s.positions[rim * 3]! - r0)
  })
})
