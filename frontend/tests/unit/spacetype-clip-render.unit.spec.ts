import { describe, it, expect, vi, beforeEach } from 'vitest'
import { structuralKey } from '../../app/lib/engine/spaceTypeEnginePool'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { sourceT01 } from '../../app/lib/engine/spaceTypeClipRenderer'
import { getEffect } from '../../app/lib/spacetype/effects/index'

describe('structuralKey', () => {
  it('changes when the effect changes', () => {
    const a = defaultSpaceTypeState()
    const b = { ...a, effectId: 'tunnel' }
    expect(structuralKey(a)).not.toBe(structuralKey(b))
  })

  it('is stable for the same state', () => {
    const a = defaultSpaceTypeState()
    expect(structuralKey(a)).toBe(structuralKey(JSON.parse(JSON.stringify(a))))
  })

  it('ignores params the effect declares as live', () => {
    // ribbon declares at least one liveKey; changing it must not force a rebuild
    const a = defaultSpaceTypeState()
    const live = getEffect(a.effectId).liveKeys?.[0]
    if (!live) return // effect has no live keys; nothing to assert
    const b = { ...a, params: { ...a.params, [live]: (a.params[live] as number) + 1 } }
    expect(structuralKey(a)).toBe(structuralKey(b))
  })
})

describe('sourceT01', () => {
  const state = defaultSpaceTypeState() // 30fps, 6s => 180 source frames

  it('maps clip-local frames onto normalized loop time', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    expect(sourceT01(clip, 0)).toBeCloseTo(0)
    expect(sourceT01(clip, 90)).toBeCloseTo(0.5)
  })

  it('tiles past the source end when loop is true', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 600 })
    expect(sourceT01(clip, 180)).toBeCloseTo(sourceT01(clip, 0))
    expect(sourceT01(clip, 270)).toBeCloseTo(sourceT01(clip, 90))
  })

  it('holds the last frame when loop is false', () => {
    const clip = { ...createSpaceTypeClip({ startFrame: 0, state, length: 600 }), loop: false }
    const last = sourceT01(clip, 179)
    expect(sourceT01(clip, 400)).toBeCloseTo(last)
  })

  it('respects in_frame as an offset into the source', () => {
    const clip = { ...createSpaceTypeClip({ startFrame: 0, state }), in_frame: 90 }
    expect(sourceT01(clip, 0)).toBeCloseTo(0.5)
  })

  it('is pure — the same frame yields the same t01 regardless of call order', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 600 })
    const forward = [0, 50, 100, 200, 300].map(f => sourceT01(clip, f))
    const backward = [300, 200, 100, 50, 0].map(f => sourceT01(clip, f)).reverse()
    expect(forward).toEqual(backward)
  })
})
