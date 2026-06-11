import { describe, it, expect } from 'vitest'
import { migrateEditState, createDefaultEditState } from '../../shared/timeline/types'
import type { MotionClip } from '../../shared/timeline/types'

describe('MotionClip in the edit state', () => {
  it('a motion clip round-trips through migrateEditState untouched', () => {
    const clip: MotionClip = {
      id: 'm1', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
      layer: { id: 'l1', kind: 'text', text: 'ADELAIDE', fontFamily: 'Inter', fontSize: 0.11,
               color: '#ffffff', align: 'center',
               animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.7, stagger: 0.035 } } },
    }
    const state = createDefaultEditState()
    state.tracks[0].clips.push(clip as any)
    const migrated = migrateEditState(JSON.parse(JSON.stringify(state)))!
    const back = migrated.tracks[0].clips[0] as MotionClip
    expect(back.kind).toBe('motion')
    expect(back.layer.text).toBe('ADELAIDE')
    expect(back.layer.animation?.in?.presetId).toBe('mask-up')
  })
})
