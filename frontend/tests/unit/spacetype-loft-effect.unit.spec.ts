import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { loftEffect, resolveShape } from '../../app/lib/spacetype/effects/loft'
import { defaultsFromControls as dfc } from '../../app/lib/spacetype/effect'

function defaultFromControls() { return dfc(loftEffect.controls) }

describe('loftEffect', () => {
  it('registers with id "loft" and required section groups', () => {
    expect(loftEffect.id).toBe('loft')
    for (const c of loftEffect.controls) expect(typeof c.group).toBe('string')
  })
  it('buildScene returns a root with drawable geometry (shape kind, fill)', () => {
    const params = dfc(loftEffect.controls)
    params.render = 'fill'
    const dummyTex = new THREE.Texture()
    const root = loftEffect.buildScene(THREE as any, params, dummyTex, { width: 800, height: 800 })
    let drawable = 0
    root.traverse(o => { if ((o as any).isMesh || (o as any).isLineSegments) drawable++ })
    expect(drawable).toBeGreaterThan(0)
    expect(root.userData.loftState).toBeTruthy()
  })
  it('stroke kind builds a Mesh (ribbon geometry — WebGL ignores GL line width)', () => {
    const params = dfc(loftEffect.controls)
    params.render = 'stroke'
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    let meshes = 0
    root.traverse(o => { if ((o as any).isMesh) meshes++ })
    expect(meshes).toBeGreaterThan(0)
  })
  it('update(spin>0) rotates without throwing', () => {
    const params = dfc(loftEffect.controls)
    params.spin = 2
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    expect(() => loftEffect.update(0.5, params, root)).not.toThrow()
    expect(root.rotation.y).not.toBe(0)
  })
  it('stashes the ramp texture under userData.tex so the engine disposes it (both modes)', () => {
    for (const render of ['fill', 'stroke'] as const) {
      const params = dfc(loftEffect.controls)
      params.render = render
      const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
      expect(root.userData.tex).toBeTruthy()
      expect((root.userData.tex as any).isTexture).toBe(true)
    }
  })
})

describe('loft motion contract', () => {
  it('liveKeys are flow+spin (no rebuild on motion edits)', () => {
    expect(loftEffect.liveKeys).toEqual(expect.arrayContaining(['flow', 'spin']))
  })
  it('loopRates reflects active motions', () => {
    const p = dfc(loftEffect.controls); p.flow = 2; p.spin = 3
    expect(loftEffect.loopRates!(p).sort()).toEqual([2, 3])
    const p0 = dfc(loftEffect.controls)
    expect(loftEffect.loopRates!(p0)).toEqual([])   // static poster
  })
  it('flow offsets the ramp uniform continuously and returns home at t=1', () => {
    const p = dfc(loftEffect.controls); p.flow = 1
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    loftEffect.update(0, p, root); const u0 = (root.userData.loftState.mat.uniforms.uFlow.value)
    loftEffect.update(0.999, p, root); const u1 = (root.userData.loftState.mat.uniforms.uFlow.value)
    expect(u0).toBeCloseTo(0); expect(u1).toBeCloseTo(0.999)
  })
})

describe('loft refinements', () => {
  it('resolveShape migrates old profileKind', () => {
    expect(resolveShape({ shape: 'star' } as any)).toBe('star')
    expect(resolveShape({ profileKind: 'word' } as any)).toBe('word')
    expect(resolveShape({ profileKind: 'shape' } as any)).toBe('oval')
    expect(resolveShape({} as any)).toBe('oval')
  })
  it('spacing>0 builds discrete sliced geometry (more/mesh objects than continuous is not required, but drawable)', () => {
    const p = defaultFromControls()
    p.spacing = 0.4; p.shape = 'oval'; p.colorSource = 'fill'
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    let drawable = 0; root.traverse((o: any) => { if (o.isMesh || o.isLineSegments) drawable++ })
    expect(drawable).toBeGreaterThan(0)
  })
  it('colorSource fill vs stops both produce a ramp texture on userData.tex', () => {
    for (const cs of ['fill', 'stops']) {
      const p = defaultFromControls(); (p as any).colorSource = cs
      const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
      expect((root.userData.tex as any).isTexture).toBe(true)
    }
  })
})

describe('loft control placement + defaults (user-visibility fixes)', () => {
  const ctrl = (k: string) => loftEffect.controls.find(c => c.key === k)!
  it("Count (copies) + Spacing live in the OPEN 'Style' section, not the collapsed 'Layout'", () => {
    // Layout starts collapsed (DEFAULT_COLLAPSED) — the item-count control must be somewhere visible.
    expect(ctrl('copies').group).toBe('Style')
    expect(ctrl('copies').label).toBe('Count')
    expect(ctrl('spacing').group).toBe('Style')
  })
  it('default fills = TWO solid stops (1 fill = uniform model; fresh loft shows a blend)', () => {
    const fills = JSON.parse(String(ctrl('fills').default))
    expect(Array.isArray(fills)).toBe(true)
    expect(fills.length).toBe(2)
    expect(fills.every((f: any) => f.type === 'solid')).toBe(true)
    expect(fills[0].a).not.toBe(fills[1].a)   // two distinct colours → a real blend
  })
})

describe('loft 2D colour texture', () => {
  it('buildScene uploads a 2-D DataTexture (width>1 && height>1) and geometry has aAcross', () => {
    const p = defaultFromControls()
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    const tex = root.userData.tex as any
    expect(tex.image.width).toBeGreaterThan(1)
    expect(tex.image.height).toBeGreaterThan(1)
    let hasAcross = false
    root.traverse((o: any) => { if (o.geometry?.getAttribute?.('aAcross')) hasAcross = true })
    expect(hasAcross).toBe(true)
  })
  it('colorSource=stops still produces a 2-D texture', () => {
    const p = defaultFromControls(); (p as any).colorSource = 'stops'
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    const tex = root.userData.tex as any
    expect(tex.image.width).toBeGreaterThan(1); expect(tex.image.height).toBeGreaterThan(1)
  })
})
