import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// Parsing a real .glb needs a binary asset + a working GLTFLoader; stub it so the
// test can focus on the cache contract clearGlbCache() exists to guarantee.
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async parseAsync() { return { scene: new THREE.Group() } }
  },
}))

import { loadGlb, clearGlbCache } from '~/lib/scene3d/glb'

describe('glb cache', () => {
  beforeEach(() => {
    clearGlbCache()
    vi.restoreAllMocks()
    // Every fetch resolves to an empty-but-valid buffer (the mocked loader ignores it).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  })

  it('fetches once per URL and serves later loads from cache', async () => {
    await loadGlb('model.glb')
    await loadGlb('model.glb')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('clearGlbCache forces the next load to re-fetch+parse (context-loss recovery relies on this)', async () => {
    await loadGlb('model.glb')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    // A lost context invalidates the cached group's GPU buffers, which clone(true)
    // shares by reference — so recovery must re-parse, not reuse.
    clearGlbCache()
    await loadGlb('model.glb')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
  })

  it('returns an independent clone per consumer so one URL can appear many times', async () => {
    const a = await loadGlb('model.glb')
    const b = await loadGlb('model.glb')
    expect(a).not.toBe(b) // distinct clones, one fetch
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })
})
