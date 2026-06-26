import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => vi.restoreAllMocks())

describe('effectThumbnails', () => {
  it('resolves to an empty map and is memoized when WebGL is unavailable', async () => {
    vi.resetModules()
    vi.doMock('~/lib/spacetype/webgl', () => ({ detectWebGL: () => false }))
    const mod = await import('~/lib/spacetype/thumbnails')
    const a = mod.effectThumbnails()
    const b = mod.effectThumbnails()
    expect(a).toBe(b) // same memoized promise
    expect(await a).toEqual({})
  })
})
