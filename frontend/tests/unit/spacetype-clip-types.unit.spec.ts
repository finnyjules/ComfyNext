import { describe, it, expect } from 'vitest'
import { createSpaceTypeClip, spaceTypeSourceFrameCount, spaceTypeClipIsStale } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { spaceTypeSourceKey } from '../../app/lib/spacetype/sourceKey'

describe('createSpaceTypeClip', () => {
  it('defaults clip length to exactly one loop of the source', () => {
    const state = defaultSpaceTypeState() // 30fps, 6s loop
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    expect(clip.kind).toBe('spacetype')
    expect(clip.length).toBe(180)
    expect(clip.in_frame).toBe(0)
    expect(clip.loop).toBe(true)
  })

  it('honours an explicit length without changing source duration', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 12, state, length: 600 })
    expect(clip.length).toBe(600)
    expect(clip.start_frame).toBe(12)
    expect(spaceTypeSourceFrameCount(clip)).toBe(180) // source is still one 6s loop
  })

  it('snapshots the state by value, not by reference', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    state.params.rows = 999
    expect(clip.state.params.rows).not.toBe(999)
  })

  it('records origin with the content hash when a node id is given', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'node-7' })
    expect(clip.origin?.node_id).toBe('node-7')
    expect(clip.origin?.state_key).toBeTruthy()
  })

  it('omits origin entirely when no node id is given', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    expect(clip.origin).toBeUndefined()
  })
})

describe('spaceTypeClipIsStale', () => {
  it('is false when the node state still hashes to the recorded key', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(clip, state)).toBe(false)
  })

  it('is true when the node state has changed', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(clip, { ...state, params: { ...state.params, rows: 3 } })).toBe(true)
  })

  it('is false with no origin and false with no node — never an error', () => {
    const state = defaultSpaceTypeState()
    const orphan = createSpaceTypeClip({ startFrame: 0, state })
    expect(spaceTypeClipIsStale(orphan, state)).toBe(false)
    const linked = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(linked, null)).toBe(false)
  })
})
