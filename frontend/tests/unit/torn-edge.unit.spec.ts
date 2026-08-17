import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TORN_EDGE, tornEdgeActive, sanitizeTornEdge, TORN_EDGE_STYLES,
} from '~/lib/compositor/tornEdge'

describe('tornEdge spec helpers', () => {
  it('DEFAULT_TORN_EDGE is a complete, active spec', () => {
    expect(DEFAULT_TORN_EDGE.style).toBe('shredded')
    expect(tornEdgeActive(DEFAULT_TORN_EDGE)).toBe(true)
  })

  it('tornEdgeActive is false for undefined and for a fully-zero spec', () => {
    expect(tornEdgeActive(undefined)).toBe(false)
    expect(tornEdgeActive(null)).toBe(false)
    expect(tornEdgeActive({ ...DEFAULT_TORN_EDGE, amount: 0, grain: 0, lipWidth: 0 })).toBe(false)
  })

  it('sanitizeTornEdge clamps out-of-range numbers and rejects bad style/colour', () => {
    const s = sanitizeTornEdge({
      style: 'nope', amount: 9999, roughness: 5, grain: -3,
      grainTexture: 2, lipWidth: 1000, lipVariation: -1, lipColor: 'blurple', seed: 3,
    })
    expect(TORN_EDGE_STYLES).toContain(s.style)   // fell back to a valid style
    expect(s.amount).toBeLessThanOrEqual(200)
    expect(s.roughness).toBe(1)
    expect(s.grain).toBe(0)
    expect(s.grainTexture).toBe(1)
    expect(s.lipWidth).toBeLessThanOrEqual(80)
    expect(s.lipVariation).toBe(0)
    expect(s.lipColor).toBe(DEFAULT_TORN_EDGE.lipColor)  // invalid hex → default
    expect(s.seed).toBe(3)
  })

  it('sanitizeTornEdge merges partial patch over current', () => {
    const cur = { ...DEFAULT_TORN_EDGE, amount: 20 }
    const s = sanitizeTornEdge({ grain: 4 }, cur)
    expect(s.amount).toBe(20)   // preserved from cur
    expect(s.grain).toBe(4)     // overridden
  })
})
