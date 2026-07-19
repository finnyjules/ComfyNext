import { describe, it, expect, vi } from 'vitest'

// getEffect pulls in canvas-based fill/gradient generation that needs a real 2D
// context this node-env suite lacks. A controllable fake lets a test pin exact
// loopRates so the k-loop maths is asserted against real logic.
vi.mock('../../app/lib/spacetype/effects/index', () => {
  const registry = new Map<string, any>()
  function getEffect(id: string) {
    const key = String(id).toLowerCase()
    if (registry.has(key)) return registry.get(key)
    return { id, label: id, controls: [], buildScene: () => ({}), update: () => {} }
  }
  return {
    getEffect,
    __registerEffect: (e: any) => registry.set(String(e.id).toLowerCase(), e),
    __clearEffects: () => registry.clear(),
  }
})

import { spaceTypeBakeFrameCount, spaceTypeLoopMultiplier, bakeCfg } from '../../app/lib/engine/spaceTypeClipBake'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { spaceTypeSourceKey } from '../../app/lib/spacetype/sourceKey'
import { __registerEffect } from '../../app/lib/spacetype/effects/index'

const st = () => defaultSpaceTypeState() // 30fps, 6s loop => 180 source frames

describe('spaceTypeBakeFrameCount', () => {
  it('bakes one cycle, not the clip length', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: st(), length: 1800 }) // 60s clip
    expect(spaceTypeBakeFrameCount(clip)).toBe(180)
    expect(spaceTypeBakeFrameCount(clip)).toBeLessThan(1800)
  })

  it('is always a whole multiple of one loop', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: st(), length: 900 })
    expect(spaceTypeBakeFrameCount(clip) % 180).toBe(0)
  })

  it('does not depend on clip length, placement, opacity or trim', () => {
    const a = createSpaceTypeClip({ startFrame: 0, state: st(), length: 180 })
    const b = { ...createSpaceTypeClip({ startFrame: 500, state: st(), length: 1800 }), opacity: 0.3, in_frame: 40 }
    expect(spaceTypeBakeFrameCount(a)).toBe(spaceTypeBakeFrameCount(b as any))
  })

  it('extends to k whole loops when the effect has an off-grid motion rate', () => {
    // 0.5 cycles per loop needs k=2 for the motion to close seamlessly.
    __registerEffect({ id: 'halfrate', label: 'halfrate', controls: [], buildScene: () => ({}), update: () => {}, loopRates: () => [0.5] })
    const clip = createSpaceTypeClip({ startFrame: 0, state: { ...st(), effectId: 'halfrate' }, length: 90 })
    expect(spaceTypeLoopMultiplier(clip)).toBe(2)
    expect(spaceTypeBakeFrameCount(clip)).toBe(360) // 2 x 180
  })
})

/** These pin the bug promoted from Task 1's review: the bake is CACHED and
 *  skipped on a key match, so anything that changes the rendered pixels must
 *  change the key — otherwise export silently reuses stale frames. */
describe('bakeCfg hashes everything that changes the pixels', () => {
  const keyFor = (clip: any) => spaceTypeSourceKey(bakeCfg(clip) as any)

  function withState(patch: Record<string, unknown>) {
    return createSpaceTypeClip({ startFrame: 0, state: { ...st(), ...patch } as any })
  }

  it('changes when post-processing changes', () => {
    const off = withState({ post: { bloom: false, bloomStrength: 0.6, bloomRadius: 0.4, bloomThreshold: 0.8, color: false, exposure: 1, contrast: 1, saturation: 1, hue: 0, chroma: false, chromaAmount: 0.25, blur: false, blurAmount: 0.01 } })
    const on = withState({ post: { bloom: true, bloomStrength: 0.6, bloomRadius: 0.4, bloomThreshold: 0.8, color: false, exposure: 1, contrast: 1, saturation: 1, hue: 0, chroma: false, chromaAmount: 0.25, blur: false, blurAmount: 0.01 } })
    expect(keyFor(off)).not.toBe(keyFor(on))
  })

  it('changes when projection changes', () => {
    expect(keyFor(withState({ projection: 'perspective' }))).not.toBe(keyFor(withState({ projection: 'isometric' })))
  })

  it('changes when pan changes', () => {
    expect(keyFor(withState({ panX: 0 }))).not.toBe(keyFor(withState({ panX: 0.4 })))
    expect(keyFor(withState({ panY: 0 }))).not.toBe(keyFor(withState({ panY: 0.4 })))
  })

  it('changes when the gradient changes', () => {
    const a = withState({ gradientStops: [{ color: '#ff0000', on: true }] })
    const b = withState({ gradientStops: [{ color: '#00ff00', on: true }] })
    expect(keyFor(a)).not.toBe(keyFor(b))
  })

  it('changes when the effect or its params change', () => {
    expect(keyFor(withState({ effectId: 'ribbon' }))).not.toBe(keyFor(withState({ effectId: 'tunnel' })))
    const base = st()
    expect(keyFor(withState({ params: { ...base.params, rows: 3 } }))).not.toBe(keyFor(withState({ params: { ...base.params, rows: 9 } })))
  })

  it('does NOT change when only placement, trim or opacity change', () => {
    const a = createSpaceTypeClip({ startFrame: 0, state: st(), length: 180 })
    const b = { ...createSpaceTypeClip({ startFrame: 900, state: st(), length: 1800 }), in_frame: 40, opacity: 0.25, fade_in: 12 }
    expect(keyFor(a)).toBe(keyFor(b))
  })

  it('covers k loops in the hashed duration, so a rate change re-bakes', () => {
    __registerEffect({ id: 'r1', label: 'r1', controls: [], buildScene: () => ({}), update: () => {}, loopRates: () => [1] })
    __registerEffect({ id: 'r2', label: 'r2', controls: [], buildScene: () => ({}), update: () => {}, loopRates: () => [0.5] })
    const one = createSpaceTypeClip({ startFrame: 0, state: { ...st(), effectId: 'r1' } as any })
    const half = createSpaceTypeClip({ startFrame: 0, state: { ...st(), effectId: 'r2' } as any })
    expect(bakeCfg(one).loopDuration).toBe(6)
    expect(bakeCfg(half).loopDuration).toBe(12)
  })
})
