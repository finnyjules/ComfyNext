// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Reset modules before each test so the cached `_cached` variable in webgl.ts
// starts fresh per-test (Vitest isolates modules per FILE, not per test).
beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

describe('detectWebGL', () => {
  it('returns false when no WebGL context is available', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as any)
    const { detectWebGL } = await import('~/lib/spacetype/webgl')
    expect(detectWebGL()).toBe(false)
  })

  it('returns true when a context is returned', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as any)
    const { detectWebGL } = await import('~/lib/spacetype/webgl')
    expect(detectWebGL()).toBe(true)
  })
})
