import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// The engine constructs a real WebGLRenderer; stub it so this runs headless — same
// pattern as spacetype-root-cache.unit.spec.ts.
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
// under vitest's `environment: 'node'` (no DOM), so stub it out; irrelevant to texture
// disposal, which is what's under test here.
vi.mock('../../app/lib/spacetype/textTexture', () => ({
  makeTextTexture: () => ({ dispose: () => {}, userData: {} }) as unknown as THREE.CanvasTexture,
}))

import { SpaceTypeEngine } from '../../app/lib/spacetype/engine'
import type { SpaceTypeEffect } from '../../app/lib/spacetype/effect'

function fakeEffect(): SpaceTypeEffect {
  return {
    id: 'a', label: 'a', controls: [],
    buildScene: (three) => new three.Object3D(),
    update: () => {},
  }
}

function engine() {
  const canvas = { width: 64, height: 64, getContext: () => ({}) } as unknown as HTMLCanvasElement
  return new SpaceTypeEngine(canvas, {
    effect: fakeEffect(),
    width: 64, height: 64, fps: 30, loopDuration: 2,
    alpha: true, bgColor: '#000000',
  })
}

/** Fake THREE.Texture — only `dispose` matters for these assertions. */
function fakeTexture() {
  return { dispose: vi.fn() } as any
}

describe('SpaceTypeEngine image texture disposal (Finding 3)', () => {
  it('disposes outgoing textures exactly once when setImageTextures replaces them with a disjoint map', () => {
    const e = engine()
    const texA1 = fakeTexture()
    const texA2 = fakeTexture()
    const mapA = new Map<string, any>([['a1.png', texA1], ['a2.png', texA2]])
    e.setImageTextures(mapA)
    expect(texA1.dispose).not.toHaveBeenCalled()
    expect(texA2.dispose).not.toHaveBeenCalled()

    const texB1 = fakeTexture()
    const mapB = new Map<string, any>([['b1.png', texB1]])
    e.setImageTextures(mapB)

    expect(texA1.dispose).toHaveBeenCalledTimes(1)
    expect(texA2.dispose).toHaveBeenCalledTimes(1)
    expect(texB1.dispose).not.toHaveBeenCalled()
  })

  it('does not dispose a texture carried over at the same identity across maps', () => {
    const e = engine()
    const shared = fakeTexture()
    const dropped = fakeTexture()
    const mapA = new Map<string, any>([['shared.png', shared], ['dropped.png', dropped]])
    e.setImageTextures(mapA)

    const mapB = new Map<string, any>([['shared.png', shared]])
    e.setImageTextures(mapB)

    expect(shared.dispose).not.toHaveBeenCalled()
    expect(dropped.dispose).toHaveBeenCalledTimes(1)
  })

  it('dispose() disposes every texture left in the current map', () => {
    const e = engine()
    const tex1 = fakeTexture()
    const tex2 = fakeTexture()
    e.setImageTextures(new Map<string, any>([['1.png', tex1], ['2.png', tex2]]))

    e.dispose()

    expect(tex1.dispose).toHaveBeenCalledTimes(1)
    expect(tex2.dispose).toHaveBeenCalledTimes(1)
  })
})
