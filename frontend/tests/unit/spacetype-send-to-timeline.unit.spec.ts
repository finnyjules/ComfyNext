import { describe, it, expect } from 'vitest'
import { addSpaceTypeClipToEditState } from '../../app/composables/useTimelineStore'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { createDefaultEditState } from '../../shared/timeline/types'
import type { EditState, SpaceTypeClip } from '../../shared/timeline/types'

/** "Send to timeline" must reach a Timeline node that has NO editor mounted.
 *
 *  The bug this guards: useTimelineStore's `state` is a module-level singleton
 *  and bind() replaces it wholesale when an editor opens, so a clip added to the
 *  in-memory store while unbound was destroyed 100% of the time — the feature's
 *  primary flow silently did nothing. These tests cover the pure read/modify/
 *  write helper that reaches a specific node's persisted edit_state instead. */
describe('addSpaceTypeClipToEditState', () => {
  const st = () => defaultSpaceTypeState()

  it('adds a spacetype clip to the video track and returns serializable JSON', () => {
    const base = JSON.stringify(createDefaultEditState())
    const out = addSpaceTypeClipToEditState(base, st(), 'node-7')
    expect(out).not.toBeNull()

    const parsed = JSON.parse(out!.json) as EditState
    const clips = parsed.tracks.flatMap(t => t.clips)
    const added = clips.filter(c => c.kind === 'spacetype') as SpaceTypeClip[]
    expect(added).toHaveLength(1)
    expect(added[0]!.origin?.node_id).toBe('node-7')
    expect(added[0]!.state.effectId).toBe(st().effectId)
  })

  it('lands on a video track, never an audio or captions track', () => {
    const base = createDefaultEditState()
    const out = addSpaceTypeClipToEditState(JSON.stringify(base), st(), 'n1')
    const parsed = JSON.parse(out!.json) as EditState
    for (const track of parsed.tracks) {
      if (track.kind !== 'video') {
        expect(track.clips.some(c => c.kind === 'spacetype'), `${track.kind} track must not receive the clip`).toBe(false)
      }
    }
  })

  it('preserves clips already on the timeline', () => {
    const first = addSpaceTypeClipToEditState(JSON.stringify(createDefaultEditState()), st(), 'n1')
    const second = addSpaceTypeClipToEditState(first!.json, st(), 'n2')
    const parsed = JSON.parse(second!.json) as EditState
    const added = parsed.tracks.flatMap(t => t.clips).filter(c => c.kind === 'spacetype')
    expect(added).toHaveLength(2)
    expect(added.map(c => (c as SpaceTypeClip).origin?.node_id)).toEqual(['n1', 'n2'])
  })

  it('starts from a default edit state when the node has never been opened', () => {
    // A fresh Timeline node has no edit_state property at all.
    const out = addSpaceTypeClipToEditState(undefined, st(), 'n1')
    expect(out).not.toBeNull()
    const parsed = JSON.parse(out!.json) as EditState
    expect(parsed.tracks.flatMap(t => t.clips).filter(c => c.kind === 'spacetype')).toHaveLength(1)
  })

  it('recovers from a corrupt edit_state rather than throwing', () => {
    const out = addSpaceTypeClipToEditState('{not json at all', st(), 'n1')
    expect(out).not.toBeNull()
    expect(JSON.parse(out!.json).tracks.flatMap((t: any) => t.clips)).toHaveLength(1)
  })

  it('accepts an already-parsed object, not only a JSON string', () => {
    const out = addSpaceTypeClipToEditState(createDefaultEditState(), st(), 'n1')
    expect(out).not.toBeNull()
    expect(JSON.parse(out!.json).tracks.flatMap((t: any) => t.clips)).toHaveLength(1)
  })

  it('returns null when there is no video track to receive the clip', () => {
    const noVideo = { ...createDefaultEditState(), tracks: [] }
    expect(addSpaceTypeClipToEditState(JSON.stringify(noVideo), st(), 'n1')).toBeNull()
  })

  it('deep-copies the state so later node edits cannot mutate the stored clip', () => {
    const shared = st()
    const out = addSpaceTypeClipToEditState(JSON.stringify(createDefaultEditState()), shared, 'n1')
    shared.params.rows = 999
    const parsed = JSON.parse(out!.json) as EditState
    const clip = parsed.tracks.flatMap(t => t.clips).find(c => c.kind === 'spacetype') as SpaceTypeClip
    expect(clip.state.params.rows).not.toBe(999)
  })
})
