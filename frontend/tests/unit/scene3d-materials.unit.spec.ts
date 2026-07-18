import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { materialFor, updateMaterial, MATCAP_IDS } from '~/lib/scene3d/materials'
import type { SceneMaterial } from '~/lib/scene3d/config'

const base = (patch: Partial<SceneMaterial> = {}): SceneMaterial =>
  ({ type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0, ...patch })

describe('scene3d materials factory', () => {
  it('maps each type to the right THREE material class', () => {
    expect(materialFor(base())).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(materialFor(base({ type: 'toon' }))).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(materialFor(base({ type: 'matcap' }))).toBeInstanceOf(THREE.MeshMatcapMaterial)
    expect(materialFor(base({ type: 'glass' }))).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(materialFor(base({ type: 'fresnel' }))).toBeInstanceOf(THREE.ShaderMaterial)
    // Gradient is a LIT standard material (ramp injected into diffuseColor via
    // onBeforeCompile) — an unlit ShaderMaterial would flatten the surface.
    expect(materialFor(base({ type: 'gradient' }))).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(materialFor(base({ type: 'image' }))).toBeInstanceOf(THREE.MeshStandardMaterial)
  })

  it('updates in place while type and identity params are unchanged', () => {
    const m = materialFor(base())
    expect(updateMaterial(m, base({ color: '#ff0000', roughness: 0.2 }))).toBe(true)
    expect((m as THREE.MeshStandardMaterial).roughness).toBe(0.2)
  })

  it('requests a rebuild on type change and identity-param change', () => {
    expect(updateMaterial(materialFor(base()), base({ type: 'toon' }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'toon' })), base({ type: 'toon', toonSteps: 5 }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'matcap' })), base({ type: 'matcap', matcap: 'gold' }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'image' })), base({ type: 'image', image: 'a.png' }))).toBe(false)
  })

  it('updates glass params in place', () => {
    const m = materialFor(base({ type: 'glass' }))
    expect(updateMaterial(m, base({ type: 'glass', ior: 2.0, thickness: 1.5 }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).ior).toBe(2.0)
  })

  it('updates gradient uniforms in place through userData', () => {
    const m = materialFor(base({ type: 'gradient' }))
    expect(updateMaterial(m, base({ type: 'gradient', gradientB: '#112233', gradientAxis: 'z' }))).toBe(true)
    expect((m.userData.gradUniforms as any).uAxis.value).toBe(2)
  })

  it('exposes the five matcap ids', () => {
    expect(MATCAP_IDS).toEqual(['chrome', 'clay', 'pearl', 'gold', 'carbon'])
  })
})
