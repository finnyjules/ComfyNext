import { describe, it, expect, vi } from 'vitest'
import { drawSpaceTypeClip } from '../../app/lib/engine/spaceTypeClipRenderer'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

vi.mock('../../app/lib/engine/spaceTypeEnginePool', () => ({
  acquireSpaceTypeEngine: () => ({ id: 1 }),
  getSpaceTypeEngine: () => null,          // simulate no engine for this frame
  releaseSpaceTypeEngine: () => {},
  structuralKey: () => 'k',
}))

describe('drawSpaceTypeClip when the engine is unavailable', () => {
  it('draws nothing and does not throw', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip({ id: 1 }, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('draws nothing when the handle itself is null', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip(null, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })
})
