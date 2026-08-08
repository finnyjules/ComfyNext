import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { loftEffect } from '../../app/lib/spacetype/effects/loft'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'

describe('loftEffect', () => {
  it('registers with id "loft" and required section groups', () => {
    expect(loftEffect.id).toBe('loft')
    for (const c of loftEffect.controls) expect(typeof c.group).toBe('string')
  })
  it('buildScene returns a root with drawable geometry (shape kind, fill)', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.render = 'fill'; params.profileKind = 'shape'
    const dummyTex = new THREE.Texture()
    const root = loftEffect.buildScene(THREE as any, params, dummyTex, { width: 800, height: 800 })
    let drawable = 0
    root.traverse(o => { if ((o as any).isMesh || (o as any).isLineSegments) drawable++ })
    expect(drawable).toBeGreaterThan(0)
    expect(root.userData.loftState).toBeTruthy()
  })
  it('stroke kind builds LineSegments', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.render = 'stroke'
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    let lines = 0
    root.traverse(o => { if ((o as any).isLineSegments) lines++ })
    expect(lines).toBeGreaterThan(0)
  })
  it('update(spin>0) rotates without throwing', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.spin = 2
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    expect(() => loftEffect.update(0.5, params, root)).not.toThrow()
    expect(root.rotation.y).not.toBe(0)
  })
})
