import { describe, it, expect } from 'vitest'
import { BENCHMARK_SHOTS } from '~/data/house-style-benchmarks'

describe('house style benchmark shots', () => {
  it('has exactly 4 stable shots', () => {
    expect(BENCHMARK_SHOTS.map(s => s.id)).toEqual(['portrait', 'scene', 'object', 'type'])
    // Frozen: thumb grids across styles are only comparable if these never change.
    expect(BENCHMARK_SHOTS.map(s => s.seed)).toEqual([101101, 202202, 303303, 404404])
  })
  it('prompts are style-neutral and non-empty', () => {
    for (const s of BENCHMARK_SHOTS) {
      expect(s.prompt.trim().length).toBeGreaterThan(10)
      expect(s.aspectRatio).toBe('1:1')
      // the server injects trigger+aesthetic — prompts must not name any style
      expect(s.prompt.toLowerCase()).not.toMatch(/style|aesthetic/)
    }
  })
})
