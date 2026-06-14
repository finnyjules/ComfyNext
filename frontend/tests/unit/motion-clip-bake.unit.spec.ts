import { describe, it, expect } from 'vitest'
import { motionClipSourceKey } from '../../app/lib/engine/motionClipBake'
import type { MotionClip } from '../../shared/timeline/types'

const CLIP: MotionClip = {
  id: 'm', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
  x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
  layer: {
    id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontWeight: 400,
    fontSize: 0.1, color: '#fff', align: 'center', axes: { wght: 100 },
    axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }],
    animation: { offset: 0 },
  },
}

describe('motionClipSourceKey', () => {
  it('is stable for identical inputs', () => {
    expect(motionClipSourceKey(CLIP, 1080, 1920, 30))
      .toBe(motionClipSourceKey(CLIP, 1080, 1920, 30))
  })
  it('changes when the layer text changes (affects baked pixels)', () => {
    const a = motionClipSourceKey(CLIP, 1080, 1920, 30)
    const b = motionClipSourceKey({ ...CLIP, layer: { ...CLIP.layer, text: 'XY' } }, 1080, 1920, 30)
    expect(a).not.toBe(b)
  })
  it('changes when canvas dims change', () => {
    expect(motionClipSourceKey(CLIP, 1080, 1920, 30))
      .not.toBe(motionClipSourceKey(CLIP, 720, 1280, 30))
  })
  it('does NOT change when only the clip transform changes (composited, not baked)', () => {
    const a = motionClipSourceKey(CLIP, 1080, 1920, 30)
    const b = motionClipSourceKey({ ...CLIP, x: 0.2, opacity: 0.5, rotation: 10 }, 1080, 1920, 30)
    expect(a).toBe(b)
  })
})
