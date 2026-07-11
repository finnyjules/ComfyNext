import { describe, it, expect } from 'vitest'
import { buildGeometry } from '../../app/lib/shapefx/geometry'
import { DEFAULT_CONFIG, type ShapeConfig } from '../../app/lib/shapefx/config'

const prim = (primitive: ShapeConfig['shape']['primitive']): ShapeConfig => ({
  ...DEFAULT_CONFIG, shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive', primitive },
})
const gem = (seed: string, vertices = 14): ShapeConfig => ({
  ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'gem', vertices },
})

describe('buildGeometry', () => {
  it('primitives produce a non-indexed geometry with a position attribute', () => {
    const g = buildGeometry(prim('cube'))
    expect(g.index).toBeNull()                       // non-indexed → crisp flat facets
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
  })

  it('every primitive kind builds without throwing', () => {
    for (const k of ['cube','sphere','cone','cylinder','prism','torus','icosahedron','octahedron'] as const) {
      expect(() => buildGeometry(prim(k))).not.toThrow()
    }
  })

  it('gem hull produces a valid non-empty geometry', () => {
    const g = buildGeometry(gem('#gem1', 16))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12) // ≥ 4 tris
  })

  it('a small 4-vertex gem still yields a valid solid', () => {
    const g = buildGeometry(gem('#x', 4))
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(12)
  })

  // ── jitter ──
  const jit = (jitter: number, seed = '#jit'): ShapeConfig => ({
    ...DEFAULT_CONFIG, seed, shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive', primitive: 'cube', jitter },
  })
  const posArr = (c: ShapeConfig): number[] => Array.from(buildGeometry(c).getAttribute('position').array as Float32Array)

  it('jitter=0 is a no-op; jitter>0 moves vertices (same count)', () => {
    const clean = posArr(jit(0))
    expect(posArr(jit(0))).toEqual(clean)              // 0 leaves it untouched
    const jittered = posArr(jit(60))
    expect(jittered).not.toEqual(clean)                // >0 perturbs
    expect(jittered.length).toBe(clean.length)         // vertices moved, not added/removed
  })

  it('jitter is deterministic per seed and varies across seeds', () => {
    expect(posArr(jit(50, '#a'))).toEqual(posArr(jit(50, '#a')))
    expect(posArr(jit(50, '#a'))).not.toEqual(posArr(jit(50, '#b')))
  })

  it('jitter does not tear the mesh — vertices coincident in the clean shape stay coincident', () => {
    const cp = buildGeometry(jit(0)).getAttribute('position')
    const jp = buildGeometry(jit(60)).getAttribute('position')
    const ckey = (i: number) => `${cp.getX(i).toFixed(4)},${cp.getY(i).toFixed(4)},${cp.getZ(i).toFixed(4)}`
    const jkey = (i: number) => `${jp.getX(i).toFixed(5)},${jp.getY(i).toFixed(5)},${jp.getZ(i).toFixed(5)}`
    const groups = new Map<string, number[]>()
    for (let i = 0; i < cp.count; i++) {
      const k = ckey(i)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(i)
    }
    let sharedGroups = 0
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue
      sharedGroups++
      const target = jkey(idxs[0]!)
      for (const i of idxs) expect(jkey(i)).toBe(target) // all moved to the same place → no crack
    }
    expect(sharedGroups).toBeGreaterThan(0) // sanity: the cube really does share corners across facets
  })
})
