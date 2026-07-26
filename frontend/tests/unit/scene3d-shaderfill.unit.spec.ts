import { describe, it, expect } from 'vitest'
import { materialFor, refreshSceneShaderFields } from '~/lib/scene3d/materials'
import { defaultDoc, createPrimitive, createGlbObject, createLight, sceneHasShaderFill, type SceneMaterial } from '~/lib/scene3d/config'
import { DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'

// Task 10 (deferred item 3): sceneHasShaderFill and per-owner field isolation had no
// unit coverage. sceneHasShaderFill is the cost gate for Scene3D's per-frame loop —
// refreshSceneShaderFields (a WebGL readback per live field) only runs when this
// returns true, so a regression here makes EVERY 3D scene pay per-frame field work
// it never used to, silently. Per-owner isolation is what keeps one Scene3D node's
// LIVE_FIELD_CEILING from being consumed by (or leaking into) another open node's
// fields — see refreshSceneShaderFields's own doc in ~/lib/scene3d/materials.ts.

const shaderSpec = (effectId: string): ShaderSpec => ({ ...DEFAULT_SHADER_SPEC, effectId })
const shaderMat = (effectId = 'fbm_warp'): SceneMaterial => ({
  type: 'shaderFill', color: '#ffffff', roughness: 0.6, metalness: 0,
  shader: shaderSpec(effectId),
})

describe('sceneHasShaderFill — the per-frame cost gate', () => {
  it('is false for an empty scene', () => {
    expect(sceneHasShaderFill(defaultDoc())).toBe(false)
  })

  it('is false for an ordinary standard-material primitive', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('is true once a primitive carries a shaderFill material with a real spec', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material = shaderMat()
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(true)
  })

  it('is false for type "shaderFill" picked but not yet configured (no spec attached)', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material = { ...shaderMat(), shader: undefined }
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('ignores a light object even if its (never-rendered) material is shaderFill', () => {
    const doc = defaultDoc()
    const light = createLight('point', doc.objects)
    light.material = shaderMat()
    doc.objects.push(light)
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('ignores a GLB material unless materialOverride is explicitly on', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('https://example.com/m.glb', doc.objects)
    glb.material = shaderMat()
    doc.objects.push(glb)
    expect(sceneHasShaderFill(doc)).toBe(false) // override absent -> the GLB's own material never renders
    glb.materialOverride = true
    expect(sceneHasShaderFill(doc)).toBe(true) // override on -> it does
  })

  it('is true if any single object in a mixed scene carries the shader material', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    doc.objects.push(createLight('point', doc.objects))
    const sphere = createPrimitive('sphere', doc.objects)
    sphere.material = shaderMat()
    doc.objects.push(sphere)
    expect(sceneHasShaderFill(doc)).toBe(true)
  })
})

describe('refreshSceneShaderFields — per-owner field isolation', () => {
  it('an owner with zero shaderFill materials is a cheap no-op', () => {
    expect(refreshSceneShaderFields(`owner-nothing-${Math.random()}`, 0, 30).frozenCount).toBe(0)
  })

  it('scopes LIVE_FIELD_CEILING to the calling owner, never pooling across two open engines', () => {
    const ownerA = `test-owner-a-${Math.random()}`
    const ownerB = `test-owner-b-${Math.random()}`
    // 5 DISTINCT descriptors each (distinct effectId) so beginFieldFrame's Set-based
    // dedup can't collapse them into fewer live fields regardless of isolation —
    // a false pass here would look identical to a true one if all specs matched.
    for (let i = 0; i < 5; i++) materialFor(shaderMat(`scene3d_owner_a_effect_${i}`), undefined, ownerA)
    for (let i = 0; i < 5; i++) materialFor(shaderMat(`scene3d_owner_b_effect_${i}`), undefined, ownerB)

    // If refreshSceneShaderFields leaked across owners (pooled both Sets of materials
    // before applying the ceiling), refreshing ownerA alone would see all 10 distinct
    // descriptors and report 10 - LIVE_FIELD_CEILING frozen, not 5 - LIVE_FIELD_CEILING.
    // This is the assertion that actually distinguishes isolated from pooled — a
    // count, not a "did it throw" check.
    expect(refreshSceneShaderFields(ownerA, 0, 30).frozenCount).toBe(5 - LIVE_FIELD_CEILING)
    expect(refreshSceneShaderFields(ownerB, 0, 30).frozenCount).toBe(5 - LIVE_FIELD_CEILING)

    // A third, unrelated owner sees neither A's nor B's materials.
    expect(refreshSceneShaderFields(`test-owner-c-${Math.random()}`, 0, 30).frozenCount).toBe(0)
  })

  it('bake requests are exempt from the ceiling even with more than LIVE_FIELD_CEILING distinct fields', () => {
    const owner = `test-owner-bake-${Math.random()}`
    const count = LIVE_FIELD_CEILING + 2
    for (let i = 0; i < count; i++) materialFor(shaderMat(`scene3d_bake_effect_${i}`), undefined, owner)
    expect(refreshSceneShaderFields(owner, 0, 30, true).frozenCount).toBe(0)
  })
})
