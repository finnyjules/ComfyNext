import { describe, it, expect } from 'vitest'
import { matchesShowWhen } from '../../app/lib/shaderfx/showWhen'

describe('matchesShowWhen', () => {
  const read = (vals: Record<string, number>) => (u: string) => vals[u] ?? 0
  it('absent → always visible', () => {
    expect(matchesShowWhen(undefined, read({}))).toBe(true)
  })
  it('scalar equals with float rounding', () => {
    const sw = { uniform: 'u_mode', equals: 1 }
    expect(matchesShowWhen(sw, read({ u_mode: 1.0 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_mode: 0.0 }))).toBe(false)
  })
  it('array equals', () => {
    const sw = { uniform: 'u_shape', equals: [14, 15] }
    expect(matchesShowWhen(sw, read({ u_shape: 15 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_shape: 3 }))).toBe(false)
  })
  it('array of conditions = AND (crystal_prism facet jitter: mode=1 AND facetStyle=3)', () => {
    const sw = [{ uniform: 'u_mode', equals: 1 }, { uniform: 'u_facetStyle', equals: 3 }]
    expect(matchesShowWhen(sw, read({ u_mode: 1, u_facetStyle: 3 }))).toBe(true)   // both → visible
    expect(matchesShowWhen(sw, read({ u_mode: 0, u_facetStyle: 3 }))).toBe(false)  // wrong mode → hidden
    expect(matchesShowWhen(sw, read({ u_mode: 1, u_facetStyle: 0 }))).toBe(false)  // wrong style → hidden
    expect(matchesShowWhen(sw, read({ u_mode: 2, u_facetStyle: 3 }))).toBe(false)  // Prism + Triangles → hidden
  })
})
