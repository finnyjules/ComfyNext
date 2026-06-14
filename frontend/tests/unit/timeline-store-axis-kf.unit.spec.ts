import { describe, it, expect } from 'vitest'
import { useTimelineStore } from '../../app/composables/useTimelineStore'
import type { MotionClip } from '../../shared/timeline/types'

// The store is a module-level singleton: each setup() appends a new track.
// We use a unique clip id per call so findClip always targets the right clip,
// and we read via .at(-1) to get the last-added track's clip.
let _clipCounter = 0

function setup() {
  const store = useTimelineStore()
  store.addTrack('video')
  const trackIdx = store.state.value.tracks.length - 1
  const trackId = store.state.value.tracks[trackIdx]!.id
  const clipId = `m_axis_${++_clipCounter}`
  const clip: MotionClip = {
    id: clipId, kind: 'motion', start_frame: 0, in_frame: 0, length: 90,
    x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
    layer: { id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontSize: 0.1, color: '#fff', align: 'center' },
  }
  store.addClip(trackId, clip)
  return { store, clipId }
}

describe('store axis-keyframe wrappers', () => {
  it('addAxisKeyframe + setAxisKeyframeEase mutate the layer', () => {
    const { store, clipId } = setup()
    store.addAxisKeyframe(clipId, 0, { wght: 100 })
    store.addAxisKeyframe(clipId, 1, { wght: 900 })
    store.setAxisKeyframeEase(clipId, 0, 'power2.out')
    const clip = store.state.value.tracks.at(-1)!.clips[0] as MotionClip
    expect(clip.layer.axisKeyframes!.map(k => k.t)).toEqual([0, 1])
    expect(clip.layer.axisKeyframes![0]!.ease).toBe('power2.out')
  })
  it('moveAxisKeyframe + removeAxisKeyframeAt work', () => {
    const { store, clipId } = setup()
    store.addAxisKeyframe(clipId, 0, { wght: 100 })
    store.moveAxisKeyframe(clipId, 0, 0.5)
    expect((store.state.value.tracks.at(-1)!.clips[0] as MotionClip).layer.axisKeyframes![0]!.t).toBe(0.5)
    store.removeAxisKeyframeAt(clipId, 0.5)
    expect((store.state.value.tracks.at(-1)!.clips[0] as MotionClip).layer.axisKeyframes).toBeUndefined()
  })
  it('selectedAxisKeyframe resolves from selection + t', () => {
    const { store, clipId } = setup()
    store.selectedClipId.value = clipId
    store.addAxisKeyframe(clipId, 0.25, { wght: 400 })
    store.selectedAxisKeyframeT.value = 0.25
    expect(store.selectedAxisKeyframe.value?.axes.wght).toBe(400)
  })
})
