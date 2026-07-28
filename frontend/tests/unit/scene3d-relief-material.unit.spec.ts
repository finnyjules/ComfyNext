import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { materialFor, updateMaterial } from '~/lib/scene3d/materials'
import { MATERIAL_DEFAULTS, type SceneMaterial } from '~/lib/scene3d/config'

const base = (patch: Partial<SceneMaterial> = {}): SceneMaterial =>
  ({ type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0, ...patch })

describe('scene3d relief on materials', () => {
  it('leaves bumpMap null when relief is absent', () => {
    const m = materialFor(base()) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
  })

  it('leaves bumpMap null when relief source is none', () => {
    const m = materialFor(base({ relief: { source: 'none', scale: 0.5 } })) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
  })

  it('sets bumpScale from relief.scale', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.4 } })) as THREE.MeshPhysicalMaterial
    expect(m.bumpScale).toBe(0.4)
  })

  // A normal map must NEVER go through the bump path — that misreads its blue channel
  // as height. Asserted as bumpMap staying null rather than normalMap being non-null,
  // because texture LOADING needs a DOM and this suite runs in node.
  it('never routes a normal map through the bump path', () => {
    const m = materialFor(base({ normalImage: 'baked.png' })) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
  })

  // The unlit shaderFill case builds a MeshBasicMaterial, which has NO bump slot.
  // Writing to it would silently do nothing; the UI disables the section, and this
  // asserts the factory agrees rather than quietly creating a dead texture.
  it('applies no relief at all to an unlit shaderFill (MeshBasicMaterial)', () => {
    const m = materialFor(base({ type: 'shaderFill', unlit: true, relief: { source: 'image', image: 'h.png', scale: 0.5 } }))
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect((m as any).bumpMap).toBeUndefined()
  })

  it('applies relief to a LIT shaderFill', () => {
    const m = materialFor(base({ type: 'shaderFill', unlit: false, relief: { source: 'image', image: 'h.png', scale: 0.5 } })) as THREE.MeshStandardMaterial
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(m.bumpScale).toBe(0.5)
  })

  it('updates relief scale IN PLACE — a slider drag must not rebuild', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.8 } }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).bumpScale).toBe(0.8)
  })

  it('rebuilds when the relief source or image changes', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'a.png', scale: 0.2 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'b.png', scale: 0.2 } }))).toBe(false)
    const m2 = materialFor(base({ relief: { source: 'image', image: 'a.png', scale: 0.2 } }))
    expect(updateMaterial(m2, base({ relief: { source: 'shader', scale: 0.2 } }))).toBe(false)
  })

  it('rebuilds when normalImage changes', () => {
    const m = materialFor(base({ normalImage: 'a.png' }))
    expect(updateMaterial(m, base({ normalImage: 'b.png' }))).toBe(false)
  })

  it('applies relief to toon and matcap materials too', () => {
    const toon = materialFor(base({ type: 'toon', relief: { source: 'image', image: 'h.png', scale: 0.3 } })) as THREE.MeshToonMaterial
    expect(toon.bumpScale).toBe(0.3)
    const matcap = materialFor(base({ type: 'matcap', relief: { source: 'image', image: 'h.png', scale: 0.3 } })) as THREE.MeshMatcapMaterial
    expect(matcap.bumpScale).toBe(0.3)
  })
})
