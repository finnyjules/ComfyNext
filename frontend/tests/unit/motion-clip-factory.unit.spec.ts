import { describe, it, expect } from 'vitest'
import { createMotionClip } from '../../app/composables/timelineMotionClip'

describe('createMotionClip', () => {
  it('builds a centered text motion clip with a default preset at the playhead', () => {
    const clip = createMotionClip({ startFrame: 30, length: 90 })
    expect(clip.kind).toBe('motion')
    expect(clip.start_frame).toBe(30)
    expect(clip.length).toBe(90)
    expect(clip.layer.kind).toBe('text')
    expect(clip.layer.text.length).toBeGreaterThan(0)
    expect(clip.layer.x).toBeCloseTo(0.5, 6)
    expect(clip.layer.animation?.in?.presetId).toBeTruthy()
  })
  it('ids are unique across calls', () => {
    expect(createMotionClip({ startFrame: 0, length: 60 }).id)
      .not.toBe(createMotionClip({ startFrame: 0, length: 60 }).id)
  })
})
