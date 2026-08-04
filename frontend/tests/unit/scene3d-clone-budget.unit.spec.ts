import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { clampedClones, applyModifiers, totalClones } from '~/lib/scene3d/modifiers'

describe('clone budget', () => {
  it('leaves a small base geometry unclamped', () => {
    // cloneCount's own param spec caps it at 12 (frontend/app/lib/scene3d/primParams.ts),
    // independent of the vertex budget — pick a value inside that range.
    const r = clampedClones({ cloneCount: 10 }, 500) // 5k vertices
    expect(r).toEqual({ count: 10, clamped: false })
  })

  it('clamps a heavy base geometry and reports it', () => {
    const r = clampedClones({ cloneCount: 100 }, 40_000) // would be 4M vertices
    expect(r.clamped).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(r.count * 40_000).toBeLessThanOrEqual(300_000)
  })

  it('never clamps below a single copy', () => {
    const r = clampedClones({ cloneCount: 100 }, 10_000_000)
    expect(r.count).toBe(1)
  })

  it('applyModifiers honours the clamp', () => {
    // 20k-vertex base at cloneCount 100 would be 2M; the budget caps it.
    const base = new THREE.SphereGeometry(0.5, 180, 110)
    const n = base.getAttribute('position').count
    expect(n).toBeGreaterThan(15_000)
    const out = applyModifiers(base, { cloneCount: 100, cloneOffsetX: 2 })
    expect(out.getAttribute('position').count).toBeLessThanOrEqual(300_000)
  })

  it('totalClones still reports the user-set figure, unclamped', () => {
    // The clamp is a render-time guard; the doc's value is what the user chose.
    // (cloneCount's own param spec caps input at 12 — see note above.)
    expect(totalClones({ cloneCount: 12 })).toBe(12)
  })
})
