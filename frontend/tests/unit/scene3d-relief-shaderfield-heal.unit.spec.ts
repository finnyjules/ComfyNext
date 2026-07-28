import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'

// Task 5 fix: "Effect selected but nothing renders" for Surface relief. getShaderHeightTexture
// (materials.ts) calls resolveField, which returns null until the shader-fx catalog has
// finished loading (async). Relief was resolved exactly once, at material-construction time,
// with the result never re-pointed (a deliberate "relief is static" decision) — so a material
// built before the catalog resolved was left with bumpMap: null PERMANENTLY. Only a manual
// source toggle (None -> Effect), which forces a material rebuild via identityKey, recovered.
//
// The fix mirrors the existing shaderFill `.map` null-map heal (see
// scene3d-shaderfill-null-map-heal.unit.spec.ts, whose mocking approach this file copies):
// `refreshSceneShaderFields` now also retries any material whose shader-relief bumpMap is
// still null (`healReliefMaterials`/`reliefHealPending` in materials.ts). Unlike the `.map`
// heal — which re-points every frame so an animating shaderFill keeps animating — this is a
// ONE-TIME null -> bound recovery: once bumpMap is non-null the material is dropped from the
// pending Set and never touched again, so relief stays static exactly as before the fix.
//
// Mocks `~/lib/shaderfill/field` directly (same as the `.map` heal spec) so the miss -> hit
// transition is deterministic, and stubs `document.createElement('canvas')` with a fake 2D
// context so the relief pixel pipeline (drawImage/getImageData/toHeightPixels/putImageData)
// can run in vitest's node environment without real Canvas2D. `hasDOM` (materials.ts's
// module-level constant) is frozen at import time, before this stub exists, so matcap/image-
// texture code paths are unaffected — only the two DYNAMIC `typeof document === 'undefined'`
// checks (getHeightTexture for image relief, buildHeightTextureFromSpec for shader relief)
// see the stub. This suite only exercises shader relief, never image relief.

const resolveFieldMock = vi.fn()

vi.mock('~/lib/shaderfill/field', () => ({
  resolveField: (...args: unknown[]) => resolveFieldMock(...args),
  withFieldFrame: (_requests: unknown, fn: (frozenCount: number, token: number) => unknown) => fn(0, 1),
}))

import { materialFor, refreshSceneShaderFields } from '~/lib/scene3d/materials'
import { DEFAULT_SHADER_SPEC } from '~/lib/spacetype/fillTile'
import type { SceneMaterial } from '~/lib/scene3d/config'

/** A fake 2D context implementing just enough of the Canvas2D surface for
 *  buildHeightTextureFromSpec's pipeline: drawImage (no-op — the "pixels" are synthetic),
 *  getImageData (returns an opaque mid-gray buffer of the requested size), putImageData
 *  (no-op). toHeightPixels itself is the REAL pure function — only its canvas plumbing is
 *  faked. */
function fakeCtx2D() {
  return {
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(Math.max(w, 0) * Math.max(h, 0) * 4)
      for (let i = 0; i < data.length; i += 4) { data[i] = 200; data[i + 1] = 200; data[i + 2] = 200; data[i + 3] = 255 }
      return { data, width: w, height: h } as unknown as ImageData
    },
    putImageData: () => {},
  }
}

/** A fresh fake `<canvas>` per `document.createElement('canvas')` call — mirrors the real
 *  code's `const c = document.createElement('canvas')` inside buildHeightTextureFromSpec. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = fakeCtx2D()
  return {
    width: 0, height: 0,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement
}

/** What the MOCKED resolveField hands back — stands in for the real field module's resolved
 *  field canvas. Only `width`/`height` are read by buildHeightTextureFromSpec before it draws
 *  into its OWN fake canvas above, so a plain sized stub is enough. */
function fakeFieldCanvas() {
  return { width: 8, height: 8 } as unknown as HTMLCanvasElement
}

const reliefMat = (): SceneMaterial => ({
  type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0,
  relief: { source: 'shader', scale: 0.3, spec: { ...DEFAULT_SHADER_SPEC, effectId: 'not_yet_loaded' } },
})

beforeEach(() => {
  resolveFieldMock.mockReset()
  vi.stubGlobal('document', { createElement: () => fakeCanvas() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('surface relief — shader-field null bumpMap heal (Task 5 fix)', () => {
  it('a resolveField MISS at material-creation time leaves bumpMap null', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(reliefMat(), undefined, ownerId) as THREE.MeshPhysicalMaterial
    expect(mat.bumpMap).toBeNull()
  })

  it('a later refreshSceneShaderFields call BINDS the bumpMap once resolveField starts hitting', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(reliefMat(), undefined, ownerId) as THREE.MeshPhysicalMaterial
    expect(mat.bumpMap).toBeNull()

    resolveFieldMock.mockReturnValue(fakeFieldCanvas())
    refreshSceneShaderFields(ownerId, 1, 30)

    expect(mat.bumpMap).not.toBeNull()
    expect(mat.bumpMap).toBeInstanceOf(THREE.CanvasTexture)
  })

  it('is a ONE-TIME heal: once bound, a later call does not rebuild or re-touch the texture', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(reliefMat(), undefined, ownerId) as THREE.MeshPhysicalMaterial

    resolveFieldMock.mockReturnValue(fakeFieldCanvas())
    refreshSceneShaderFields(ownerId, 1, 30)
    const healedTex = mat.bumpMap
    expect(healedTex).not.toBeNull()
    // materialFor's own construction-time attempt (the miss) + healReliefMaterials' one
    // retry (the hit) — exactly two resolveField calls so far.
    expect(resolveFieldMock).toHaveBeenCalledTimes(2)

    // A later frame, even with resolveField now returning a DIFFERENT canvas (as it would
    // for an animating field) or continuing to hit, must NOT touch this material again —
    // relief is static once bound, unlike the shaderFill `.map` live-repoint.
    resolveFieldMock.mockReturnValue(fakeFieldCanvas())
    refreshSceneShaderFields(ownerId, 2, 30)
    refreshSceneShaderFields(ownerId, 3, 30)

    expect(mat.bumpMap).toBe(healedTex)               // same texture object — never rebuilt
    expect(resolveFieldMock).toHaveBeenCalledTimes(2)  // no further resolveField calls at all
  })

  it('a HIT at material-creation time needs no heal — bumpMap is bound immediately', () => {
    resolveFieldMock.mockReturnValue(fakeFieldCanvas())
    const ownerId = `test-owner-${Math.random()}`
    const mat = materialFor(reliefMat(), undefined, ownerId) as THREE.MeshPhysicalMaterial
    expect(mat.bumpMap).not.toBeNull()

    // No pending heal was ever queued, so a later refreshSceneShaderFields call for this
    // owner makes no further resolveField calls for this material.
    const callsAfterConstruction = resolveFieldMock.mock.calls.length
    refreshSceneShaderFields(ownerId, 1, 30)
    expect(resolveFieldMock.mock.calls.length).toBe(callsAfterConstruction)
  })

  it('scopes the heal to the owning engine — another owner never triggers or steals it', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerA = `test-owner-a-${Math.random()}`
    const ownerB = `test-owner-b-${Math.random()}`
    const mat = materialFor(reliefMat(), undefined, ownerA) as THREE.MeshPhysicalMaterial
    expect(mat.bumpMap).toBeNull()

    resolveFieldMock.mockReturnValue(fakeFieldCanvas())
    refreshSceneShaderFields(ownerB, 1, 30) // wrong owner — must not heal A's material
    expect(mat.bumpMap).toBeNull()

    refreshSceneShaderFields(ownerA, 1, 30) // right owner — heals
    expect(mat.bumpMap).not.toBeNull()
  })
})
