import { describe, it, expect } from 'vitest'
import { nodeSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

function sampleState(over: Partial<SpaceTypeState> = {}): SpaceTypeState {
  return {
    effectId: 'cylinder',
    params: { text: 'NOIR' },
    gradientStops: [],
    fps: 30,
    loopDuration: 6,
    dimsKey: '16:9',
    transparent: true,
    bgColor: '#000000',
    ...over,
  }
}

describe('nodeSpaceTypeStateSource', () => {
  it('reads sailor_spaceType off the node, null when absent', () => {
    let node: any = { data: { properties: {} } }
    const src = nodeSpaceTypeStateSource(() => node)
    expect(src.read()).toBeNull()
    node.data.properties.sailor_spaceType = sampleState()
    expect(src.read()?.effectId).toBe('cylinder')
  })

  it('write persists onto the node and PRESERVES extra keys (thumb)', () => {
    const node: any = { data: { properties: { sailor_spaceType: { thumb: '/view?x' } } } }
    const src = nodeSpaceTypeStateSource(() => node)
    src.write(sampleState({ effectId: 'ribbon' }))
    const blob = node.data.properties.sailor_spaceType
    expect(blob.effectId).toBe('ribbon')
    expect(blob.thumb).toBe('/view?x') // extra key survived
  })

  it('read/write is a no-op-safe round trip when the node is missing', () => {
    const src = nodeSpaceTypeStateSource(() => undefined)
    expect(src.read()).toBeNull()
    expect(() => src.write(sampleState())).not.toThrow()
  })
})

import { clipSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { createSpaceTypeClip } from '~/composables/timelineSpaceTypeClip'

describe('clipSpaceTypeStateSource + updateSpaceTypeClipState', () => {
  it('reads clip.state, writes it back, and DETACHES origin on write', () => {
    const store = useTimelineStore()
    // seed a bound timeline with one track holding a spacetype clip that HAS an origin
    store.bind('tl-node-1', () => null, () => {})
    store.addTrack('video')
    const trackId = store.state.value.tracks[store.state.value.tracks.length - 1]!.id
    const clip = createSpaceTypeClip({ startFrame: 0, state: sampleState(), originNodeId: 'origin-node' })
    store.addClip(trackId, clip)

    const src = clipSpaceTypeStateSource(clip.id)
    expect(src.read()?.effectId).toBe('cylinder')
    expect(clip.origin).toBeTruthy() // pre: pinned to origin

    src.write(sampleState({ effectId: 'ribbon' }))
    const after = store.state.value.tracks.flatMap(t => t.clips).find(c => c.id === clip.id) as any
    expect(after.state.effectId).toBe('ribbon')  // edit applied
    expect(after.origin).toBeFalsy()              // detached
  })

  it('write preserves the clip window (in_frame / length / start_frame)', () => {
    const store = useTimelineStore()
    store.bind('tl-node-2', () => null, () => {})
    store.addTrack('video')
    const trackId = store.state.value.tracks[store.state.value.tracks.length - 1]!.id
    const clip = createSpaceTypeClip({ startFrame: 90, state: sampleState(), length: 45 })
    store.addClip(trackId, clip)

    clipSpaceTypeStateSource(clip.id).write(sampleState({ effectId: 'ribbon', loopDuration: 3 }))
    const after = store.state.value.tracks.flatMap(t => t.clips).find(c => c.id === clip.id) as any
    expect(after.start_frame).toBe(90)
    expect(after.in_frame).toBe(0)
    expect(after.length).toBe(45)  // trim untouched by a content edit
  })
})
