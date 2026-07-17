import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from '../../app/composables/useTimelineStore'
import type { ImageClip, AudioClip } from '../../shared/timeline/types'

function img(id: string, start: number, length: number): ImageClip {
  return { id, kind: 'image', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}
function aud(id: string, start: number, length: number): AudioClip {
  return { id, kind: 'audio', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}

// NOTE: the clipboard is module-level ON PURPOSE (it survives editor
// close/reopen), so it persists across tests too — tests are ordered so
// empty-clipboard assertions run before anything copies.
describe('timeline clipboard', () => {
  const store = useTimelineStore()
  let videoTrackId: string

  beforeEach(() => {
    store.bind('test-node', () => undefined, () => {})
    videoTrackId = store.state.value.tracks[0]!.id
  })

  it('paste with an empty clipboard is a no-op (runs first)', () => {
    expect(store.hasClipboard.value).toBe(false)
    expect(store.pasteClips(0)).toEqual([])
    expect(store.canUndo.value).toBe(false)
  })

  it('duplicate appends after the source clip and does not touch the clipboard', () => {
    store.addClip(videoTrackId, img('a', 10, 30))
    const ids = store.duplicateClips(['a'])
    const dup = store.state.value.tracks[0]!.clips.find(c => c.id === ids[0])
    expect(dup!.start_frame).toBe(40)
    expect(store.hasClipboard.value).toBe(false)  // still nothing copied
  })

  it('copy + paste places clones at the target frame with fresh ids, one undo step', () => {
    store.addClip(videoTrackId, img('a', 10, 30))
    store.addClip(videoTrackId, img('b', 50, 20))
    expect(store.copyClips(['a', 'b'])).toBe(2)
    const ids = store.pasteClips(100)
    expect(ids).toHaveLength(2)
    const clips = store.state.value.tracks[0]!.clips
    const pasted = clips.filter(c => ids.includes(c.id))
    // earliest clip lands at 100; relative offset (40) preserved
    expect(pasted.map(c => c.start_frame).sort((x, y) => x - y)).toEqual([100, 140])
    expect(pasted.every(c => c.id !== 'a' && c.id !== 'b')).toBe(true)
    store.undo()   // one step removes BOTH pasted clips
    expect(store.state.value.tracks[0]!.clips).toHaveLength(2)
  })

  it('paste routes to a matching-kind track when the source track is gone', () => {
    store.addTrack('audio')
    const audioTrackId = store.state.value.tracks[1]!.id
    store.addClip(audioTrackId, aud('m', 0, 40))
    store.copyClips(['m'])
    store.removeTrack(audioTrackId)
    const ids = store.pasteClips(0)
    expect(ids).toHaveLength(1)
    const target = store.state.value.tracks.find(t => t.clips.some(c => c.id === ids[0]))
    expect(target!.kind).toBe('audio')   // created (or reused) an audio track
  })

  it('copying a fresh selection replaces the previous clipboard', () => {
    store.addClip(videoTrackId, img('x', 0, 10))
    store.copyClips(['x'])
    const ids = store.pasteClips(500)
    expect(ids).toHaveLength(1)
    expect(store.state.value.tracks[0]!.clips.find(c => c.id === ids[0])!.start_frame).toBe(500)
  })
})
