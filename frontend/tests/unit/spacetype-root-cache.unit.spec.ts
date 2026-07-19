import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// The engine constructs a real WebGLRenderer; stub it so this runs headless.
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three')
  class FakeRenderer {
    domElement = { width: 0, height: 0 } as unknown as HTMLCanvasElement
    shadowMap = { enabled: false, type: 0 }
    setSize() {}
    setPixelRatio() {}
    setClearColor() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
    getContext() { return {} }
  }
  return { ...actual, WebGLRenderer: FakeRenderer }
})

// makeTextTexture() draws to a `document.createElement('canvas')` — these unit tests run
// under vitest's `environment: 'node'` (no DOM), so stub it out; texture content is
// irrelevant to the root-cache/LRU behaviour under test.
vi.mock('../../app/lib/spacetype/textTexture', () => ({
  makeTextTexture: () => ({ dispose: () => {}, userData: {} }) as unknown as THREE.CanvasTexture,
}))

import { SpaceTypeEngine, ROOT_CACHE_LIMIT } from '../../app/lib/spacetype/engine'
import type { SpaceTypeEffect } from '../../app/lib/spacetype/effect'

function fakeEffect(id: string, onBuild: () => void): SpaceTypeEffect {
  return {
    id,
    label: id,
    controls: [],
    buildScene: (three) => { onBuild(); return new three.Object3D() },
    update: () => {},
  }
}

function engine() {
  const canvas = { width: 64, height: 64, getContext: () => ({}) } as unknown as HTMLCanvasElement
  return new SpaceTypeEngine(canvas, {
    effect: fakeEffect('a', () => {}),
    width: 64, height: 64, fps: 30, loopDuration: 2,
    alpha: true, bgColor: '#000000',
  })
}

const TEX = {} as any

describe('SpaceTypeEngine root cache', () => {
  let builds: Record<string, number>
  beforeEach(() => { builds = {} })

  function eff(id: string) {
    return fakeEffect(id, () => { builds[id] = (builds[id] ?? 0) + 1 })
  }

  it('builds once per key and reuses on repeat', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(builds.a).toBe(1)
  })

  it('does not rebuild when alternating between two cached keys', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k2', eff('b'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k2', eff('b'), {}, TEX)
    expect(builds.a).toBe(1)
    expect(builds.b).toBe(1)
    expect(e.cachedRootCount).toBe(2)
  })

  it('evicts least-recently-used past the limit', () => {
    const e = engine()
    for (let i = 0; i < ROOT_CACHE_LIMIT + 1; i++) e.buildKeyed(`k${i}`, eff(`e${i}`), {}, TEX)
    expect(e.cachedRootCount).toBe(ROOT_CACHE_LIMIT)
    // k0 was evicted, so touching it rebuilds
    e.buildKeyed('k0', eff('e0'), {}, TEX)
    expect(builds.e0).toBe(2)
  })

  it('keeps the most recently used key resident under eviction pressure', () => {
    const e = engine()
    e.buildKeyed('hot', eff('hot'), {}, TEX)
    for (let i = 0; i < ROOT_CACHE_LIMIT - 1; i++) {
      e.buildKeyed(`k${i}`, eff(`e${i}`), {}, TEX)
      e.buildKeyed('hot', eff('hot'), {}, TEX) // keep touching it
    }
    e.buildKeyed('overflow', eff('of'), {}, TEX)
    e.buildKeyed('hot', eff('hot'), {}, TEX)
    expect(builds.hot).toBe(1)
  })

  it('clearRootCache drops everything', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.clearRootCache()
    expect(e.cachedRootCount).toBe(0)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(builds.a).toBe(2)
  })
})
