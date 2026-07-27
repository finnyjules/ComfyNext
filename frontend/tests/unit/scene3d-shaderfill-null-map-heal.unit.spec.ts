import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// Final review, Item 3 (Critical, residual) / the "null-map heal" the review asked to be
// unit-tested directly: `materialFor`'s `shaderFill` case does
// `tex2 = canvas ? new THREE.CanvasTexture(canvas) : null` — when `resolveField` misses
// (the shader-fx catalog hasn't resolved yet, or a transient WebGL failure), `.map` is
// left `null` at material-creation time. `refreshSceneShaderFields`'s heal branch is
// supposed to notice a null `.map` on its NEXT call and build the texture the
// constructor couldn't — but that branch runs ONLY from something calling
// `refreshSceneShaderFields`; the real production bug (render.ts's `renderMotionFrame`
// never calling it at all) is Vue/engine-level and out of reach for a plain unit test.
// What IS unit-testable, and is the actual mechanism the render.ts fix now activates
// for that host, is proven here: mock `~/lib/shaderfill/field` so the miss → hit
// transition is deterministic, and confirm `refreshSceneShaderFields` heals a null
// `.map` in place once a canvas becomes available.

const resolveFieldMock = vi.fn()

vi.mock('~/lib/shaderfill/field', () => ({
  resolveField: (...args: unknown[]) => resolveFieldMock(...args),
  withFieldFrame: (_requests: unknown, fn: (frozenCount: number, token: number) => unknown) => fn(0, 1),
}))

import { materialFor, refreshSceneShaderFields } from '~/lib/scene3d/materials'
import { DEFAULT_SHADER_SPEC } from '~/lib/spacetype/fillTile'
import type { SceneMaterial } from '~/lib/scene3d/config'

function fakeCanvas() {
  return { width: 8, height: 8 } as unknown as HTMLCanvasElement
}

const shaderMat = (effectId: string): SceneMaterial => ({
  type: 'shaderFill', color: '#ffffff', roughness: 0.6, metalness: 0,
  shader: { ...DEFAULT_SHADER_SPEC, effectId },
})

beforeEach(() => {
  resolveFieldMock.mockReset()
})

describe('materialFor + refreshSceneShaderFields — null-map heal (Item 3 mechanism)', () => {
  it('a resolveField MISS at material-creation time leaves .map null, but still registers the material', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(shaderMat('not_yet_loaded'), undefined, ownerId) as THREE.MeshStandardMaterial

    expect(mat.map).toBeNull()

    // The material must still be tracked for this owner so a LATER
    // refreshSceneShaderFields call can find and heal it — this is what
    // `shaderFillMaterials.add(t)` running unconditionally (even on a miss) buys.
    const { frozenCount } = refreshSceneShaderFields(ownerId, 0, 30)
    expect(frozenCount).toBe(0)   // sanity: not ceiling-capped, just still null
    expect(mat.map).toBeNull()    // still null — resolveField mocked to null again
  })

  it('heals a null .map in place once resolveField starts succeeding, without rebuilding the material', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(shaderMat('not_yet_loaded'), undefined, ownerId) as THREE.MeshStandardMaterial
    expect(mat.map).toBeNull()

    const realCanvas = fakeCanvas()
    resolveFieldMock.mockReturnValue(realCanvas)
    refreshSceneShaderFields(ownerId, 1, 30)

    expect(mat.map).not.toBeNull()
    expect((mat.map as THREE.CanvasTexture).image).toBe(realCanvas)
  })

  it('once healed, a later canvas is swapped onto the SAME texture object, never a new one', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(shaderMat('not_yet_loaded'), undefined, ownerId) as THREE.MeshStandardMaterial

    const canvasA = fakeCanvas()
    resolveFieldMock.mockReturnValue(canvasA)
    refreshSceneShaderFields(ownerId, 1, 30)
    const healedTex = mat.map as THREE.CanvasTexture
    expect(healedTex.image).toBe(canvasA)

    const canvasB = fakeCanvas()
    resolveFieldMock.mockReturnValue(canvasB)
    refreshSceneShaderFields(ownerId, 2, 30)
    expect(mat.map).toBe(healedTex)              // same texture object — per resolveField's ownership contract
    expect((mat.map as THREE.CanvasTexture).image).toBe(canvasB)
  })

  it('a HIT at material-creation time needs no heal — .map is set immediately', () => {
    const realCanvas = fakeCanvas()
    resolveFieldMock.mockReturnValue(realCanvas)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(shaderMat('already_loaded'), undefined, ownerId) as THREE.MeshStandardMaterial
    expect((mat.map as THREE.CanvasTexture).image).toBe(realCanvas)
  })
})
