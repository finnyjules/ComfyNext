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
    // cloneCount's own param spec caps it at 12, so `cloneCount: 100` here
    // actually resolves to 12 copies. SphereGeometry(0.5, 200, 130) has 26,331
    // vertices (verified directly against three.js), so 12 copies would be
    // 315,972 — over the 300,000 budget — and the cloner must clamp below 12.
    const base = new THREE.SphereGeometry(0.5, 200, 130)
    const n = base.getAttribute('position').count
    expect(n).toBe(26_331)
    const out = applyModifiers(base, { cloneCount: 100, cloneOffsetX: 2 })
    const outCount = out.getAttribute('position').count
    expect(outCount).toBeLessThanOrEqual(300_000)
    // Proves clamping actually ran, not just that the result happens to be
    // small: 12 unclamped copies would exceed the budget, so the result must
    // fall strictly short of that.
    expect(outCount).toBeLessThan(12 * n)
  })

  it('applyModifiers clamps grid mode, the catastrophic case', () => {
    // Grid mode multiplies three independent axis counts, each capped at 5 by
    // their own param spec, so 5x5x5 = 125 copies is reachable — 125 * 26,331
    // would be ~3.29M vertices, and the cloner must clamp it hard.
    const base = new THREE.SphereGeometry(0.5, 200, 130)
    const n = base.getAttribute('position').count
    const out = applyModifiers(base, {
      cloneMode: 2,
      cloneCountX: 5,
      cloneCountY: 5,
      cloneCountZ: 5,
    })
    const outCount = out.getAttribute('position').count
    expect(outCount).toBeLessThanOrEqual(300_000)
    expect(outCount).toBeLessThan(125 * n)
  })

  it('totalClones still reports the user-set figure, unclamped', () => {
    // The clamp is a render-time guard; the doc's value is what the user chose.
    // (cloneCount's own param spec caps input at 12 — see note above.)
    expect(totalClones({ cloneCount: 12 })).toBe(12)
  })

  it('clampedClones clamps grid mode and totalClones still reports the full unclamped figure', () => {
    const modifiers = { cloneMode: 2, cloneCountX: 5, cloneCountY: 5, cloneCountZ: 5 }
    // 125 copies * 40,000 vertices = 5,000,000 — far over the 300,000 budget.
    const r = clampedClones(modifiers, 40_000)
    expect(r.clamped).toBe(true)
    expect(r.count * 40_000).toBeLessThanOrEqual(300_000)
    // The doc's value (what the panel shows back to the user) must survive
    // unclamped, even though the render-time guard reduces the actual count.
    expect(totalClones(modifiers)).toBe(125)
  })
})
