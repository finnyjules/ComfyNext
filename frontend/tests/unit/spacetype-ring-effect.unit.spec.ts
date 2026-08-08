import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ringEffect } from '~/lib/spacetype/effects/ring'
import { defaultsFromControls } from '~/lib/spacetype/effect'

function imageParams(n: number) {
  const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, kind: 'image', src: `data:${i}` }))
  return { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items) }
}

describe('ringEffect', () => {
  it('builds one quad per image tile', () => {
    const params = imageParams(6)
    const env = { width: 960, height: 540, imageTextures: new Map() }
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), env)
    const st = (root as any).userData.ringState
    expect(st.quads).toHaveLength(6)
  })

  it('update places quads on the ring radius', () => {
    const params = imageParams(4)
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
    ringEffect.update!(0, params, root)
    const st = (root as any).userData.ringState
    const r = Number(params.radius)
    for (const q of st.quads) {
      expect(Math.hypot(q.position.x, q.position.z)).toBeCloseTo(r, 4)
    }
  })

  it('loopRates reflects speed as whole turns', () => {
    expect(ringEffect.loopRates!({ ...defaultsFromControls(ringEffect.controls), speed: 3 })).toEqual([3])
  })

  it('repeater duplicates tiles around the ring', () => {
    const items = [
      { id: 'i0', kind: 'image', src: 'data:0' },
      { id: 'i1', kind: 'image', src: 'data:1' },
    ]
    const params = { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items), repeat: 3 }
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
    expect((root as any).userData.ringState.quads).toHaveLength(6)
  })

  it('is registered in the effect list', async () => {
    const { SPACE_TYPE_EFFECTS } = await import('~/lib/spacetype/effects/index')
    expect(SPACE_TYPE_EFFECTS.some(e => e.id === 'ring')).toBe(true)
  })

  it('bend builds and updates without error', () => {
    const items = [{ id: 'i0', kind: 'image', src: 'data:0' }, { id: 'i1', kind: 'image', src: 'data:1' }]
    const params = { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items), bend: 1 }
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
    expect(() => ringEffect.update!(0.25, params, root)).not.toThrow()
    expect((root as any).userData.ringState.quads).toHaveLength(2)
  })

  it('renders finite (no NaN) for a pre-tuneup doc missing the new keys', () => {
    const legacy = {
      content: JSON.stringify([{ id: 'i0', kind: 'image', src: 'data:0' }, { id: 'i1', kind: 'image', src: 'data:1' }]),
      radius: 5, ringTilt: -0.28, cardSize: 1.4, perspective: 0.4, speed: 1, direction: 'cw',
    }
    const root = ringEffect.buildScene(THREE, legacy as any, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
    ringEffect.update!(0.25, legacy as any, root)
    expect(Number.isFinite(root.rotation.x)).toBe(true)
    expect(Number.isFinite(root.rotation.z)).toBe(true)
    for (const q of (root as any).userData.ringState.quads) {
      expect(Number.isFinite(q.scale.x)).toBe(true)
      const pos = (q.geometry.attributes.position as any).array as Float32Array
      expect(pos.every((v: number) => Number.isFinite(v))).toBe(true)
    }
  })
})
