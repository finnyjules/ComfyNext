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

/** An effect whose buildScene() always throws — used to exercise build()'s internal
 *  catch (it never lets exceptions escape) and the resulting failed-build state. */
function throwingEffect(id: string): SpaceTypeEffect {
  return {
    id,
    label: id,
    controls: [],
    buildScene: () => { throw new Error(`${id} build failed`) },
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

  it('caps cache size at the limit and evicts the oldest key first', () => {
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

  // Regression (Finding 1): a failed build used to leave `activeKey` pointing at a key
  // whose root had already been detached from the scene. A later buildKeyed() for that
  // same (still-cached) key then hit the fast path and returned without re-mounting
  // anything, leaving the canvas permanently blank.
  it('remounts the previous key after a failed build instead of staying blank', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(e.scene.children.length).toBe(1)

    // Switching to a key whose effect throws during buildScene: build() swallows the
    // exception internally, so nothing new gets mounted — but k1 was already detached.
    e.buildKeyed('k2', throwingEffect('bad'), {}, TEX)
    expect(e.scene.children.length).toBe(0)

    // k1 is still resident in the cache; switching back to it must remount it rather
    // than short-circuiting on a stale activeKey.
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(e.scene.children.length).toBe(1)
    expect(builds.a).toBe(1) // reused the cached root, did not rebuild
  })

  // Regression (Finding 2): clearRootCache() skips disposing the mounted root, assuming
  // dispose() immediately follows and handles it. Called standalone, that skip becomes a
  // leak: the mounted root is dropped from the cache without being disposed, and a later
  // buildKeyed() for a different key overwrites `this.root`, dropping the last reference
  // to its geometry/material without ever calling .dispose() on them.
  it('disposes the mounted root when clearRootCache is called standalone', () => {
    const e = engine()
    // buildScene returns a real Mesh (not a bare Object3D) so disposeRoot's traversal
    // (which gates disposal on `mesh.isMesh`) actually has geometry/material to dispose.
    const meshEffect: SpaceTypeEffect = {
      id: 'mesh', label: 'mesh', controls: [],
      buildScene: (three) => new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial()),
      update: () => {},
    }
    e.buildKeyed('k1', meshEffect, {}, TEX)
    const mounted = e.scene.children[0] as THREE.Mesh
    const disposeSpy = vi.spyOn(mounted.geometry, 'dispose')

    e.clearRootCache()

    expect(disposeSpy).toHaveBeenCalled()
    // State must stay coherent: nothing mounted, nothing cached, no dangling activeKey.
    expect(e.scene.children.length).toBe(0)
    expect(e.cachedRootCount).toBe(0)

    // Switching to a new key afterwards must not attempt to touch the already-disposed
    // former root (e.g. double-remove/double-dispose it).
    expect(() => e.buildKeyed('k2', eff('b'), {}, TEX)).not.toThrow()
    expect(builds.b).toBe(1)
  })

  // Regression (loft findings): disposeRoot()'s geometry/material disposal used to gate on
  // `isMesh` only. THREE.LineSegments (used by loft's stroke render mode) sets `isLineSegments`,
  // not `isMesh`, so its geometry/material were silently skipped and leaked on every rebuild.
  // build() (unlike buildKeyed, which pools roots) calls disposeRoot() on the previously
  // mounted root at the top of every call — the direct seam to exercise disposeRoot().
  it('disposes geometry and material for LineSegments children, not just Mesh', () => {
    const e = engine()
    const lineEffect: SpaceTypeEffect = {
      id: 'lines', label: 'lines', controls: [],
      buildScene: (three) => new three.LineSegments(
        new three.BufferGeometry(),
        new three.LineBasicMaterial(),
      ),
      update: () => {},
    }
    e.setEffect(lineEffect)
    e.build({}, {} as any)
    const mounted = e.scene.children[0] as THREE.LineSegments
    const geoSpy = vi.spyOn(mounted.geometry, 'dispose')
    const matSpy = vi.spyOn(mounted.material as THREE.Material, 'dispose')

    // A second build() call disposes the previously mounted root via disposeRoot().
    e.setEffect(eff('b'))
    e.build({}, {} as any)

    expect(geoSpy).toHaveBeenCalled()
    expect(matSpy).toHaveBeenCalled()
  })
})
