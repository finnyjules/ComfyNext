import { describe, it, expect } from 'vitest'
import {
  migrateEditState, createDefaultEditState, EDIT_STATE_VERSION,
} from '../../shared/timeline/types'

describe('migrateEditState', () => {
  it('upgrades a v1 state to v2 with empty transitions', () => {
    const v1 = {
      version: 1,
      canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
      tracks: [{ id: 't1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] }],
      total_frames: 0,
    }
    const out = migrateEditState(v1)
    expect(out).not.toBeNull()
    expect(out!.version).toBe(EDIT_STATE_VERSION)
    expect(out!.transitions).toEqual([])
    expect(out!.tracks).toHaveLength(1)
  })

  it('passes a v2 state through, preserving transitions', () => {
    const v2 = {
      ...createDefaultEditState(),
      transitions: [{
        id: 'tr1', track_id: 't1', from_clip_id: 'a', to_clip_id: 'b',
        kind: 'crossfade', duration: 12,
      }],
    }
    const out = migrateEditState(JSON.parse(JSON.stringify(v2)))
    expect(out!.transitions).toHaveLength(1)
    expect(out!.transitions[0]!.kind).toBe('crossfade')
  })

  it('rejects garbage', () => {
    expect(migrateEditState(null)).toBeNull()
    expect(migrateEditState('nope')).toBeNull()
    expect(migrateEditState({ version: 99, tracks: [] })).toBeNull()
    expect(migrateEditState({ version: 2 })).toBeNull() // no tracks array
    expect(migrateEditState({ version: 2, tracks: [] })).toBeNull() // no canvas
  })

  it('v1 clip payloads survive migration untouched', () => {
    const clip = {
      id: 'c1', kind: 'video', asset_id: 'a1',
      start_frame: 0, in_frame: 0, length: 30,
      keyframes: [{ frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }],
      blend: 'multiply',
      fade_in: 5,
    }
    const v1 = {
      version: 1,
      canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
      tracks: [{ id: 't1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [clip] }],
      total_frames: 0,
    }
    const out = migrateEditState(v1)
    expect(out).not.toBeNull()
    const outClip = out!.tracks[0]!.clips[0]!
    expect(outClip).toEqual(expect.objectContaining({
      keyframes: clip.keyframes,
      blend: 'multiply',
      fade_in: 5,
    }))
  })

  it('returns the same object reference (in-place mutation)', () => {
    const input = {
      version: 1 as const,
      canvas: { width: 1920, height: 1080, fps: 24, bg_color: '#000000' },
      tracks: [],
      total_frames: 0,
    }
    const out = migrateEditState(input)
    expect(out).toBe(input)
  })

  it('createDefaultEditState is a valid v2 state', () => {
    const s = createDefaultEditState()
    expect(s.version).toBe(EDIT_STATE_VERSION)
    expect(s.transitions).toEqual([])
    expect(migrateEditState(JSON.parse(JSON.stringify(s)))).not.toBeNull()
  })
})
