import { describe, it, expect } from 'vitest'
import { createSpaceTypeClip, spaceTypeClipIsStale, spaceTypeStateKey } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

/** Mirrors the patch syncSpaceTypeClipFromNode dispatches, without mounting the store. */
function syncPatch(nodeState: ReturnType<typeof defaultSpaceTypeState>, nodeId: string) {
  return {
    state: JSON.parse(JSON.stringify(nodeState)),
    origin: { node_id: nodeId, state_key: spaceTypeStateKey(nodeState) },
  }
}

describe('sync from node', () => {
  it('clears staleness and adopts the new state', () => {
    const original = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state: original, originNodeId: 'n1' })
    const edited = { ...original, params: { ...original.params, rows: 3 } }
    expect(spaceTypeClipIsStale(clip, edited)).toBe(true)

    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(spaceTypeClipIsStale(synced as any, edited)).toBe(false)
    expect((synced as any).state.params.rows).toBe(3)
  })

  it('preserves clip placement and trim across a sync', () => {
    const original = defaultSpaceTypeState()
    const clip = { ...createSpaceTypeClip({ startFrame: 48, state: original, originNodeId: 'n1' }), length: 300, in_frame: 12, opacity: 0.5 }
    const edited = { ...original, effectId: 'tunnel' }
    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(synced.start_frame).toBe(48)
    expect(synced.length).toBe(300)
    expect(synced.in_frame).toBe(12)
    expect(synced.opacity).toBe(0.5)
  })

  it('invalidates a stale bake when the state changes', () => {
    const original = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state: original, originNodeId: 'n1' })
    clip.spacetype_bake = { source_key: spaceTypeStateKey(original), frames: ['a.png'], fps: 30, external: true }
    const edited = { ...original, params: { ...original.params, rows: 7 } }
    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(synced.spacetype_bake!.source_key).not.toBe(spaceTypeStateKey(edited))
  })
})
