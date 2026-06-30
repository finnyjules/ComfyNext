import { describe, it, expect } from 'vitest'
import { repairPromptFor, pointFromTarget } from '../../server/utils/anatomyRepair'

describe('repairPromptFor', () => {
  it('returns a hand-specific prompt for hand', () => {
    expect(repairPromptFor('hand')).toMatch(/five fingers/i)
  })
  it('returns a face-specific prompt for face', () => {
    expect(repairPromptFor('face')).toMatch(/face/i)
  })
  it('falls back to the hand prompt for an unknown kind', () => {
    // @ts-expect-error testing the runtime fallback
    expect(repairPromptFor('nonsense')).toBe(repairPromptFor('hand'))
  })
})

describe('pointFromTarget', () => {
  it('passes an explicit pixel point straight through', () => {
    expect(pointFromTarget({ point: { xPx: 120, yPx: 340 } })).toEqual({ xPx: 120, yPx: 340 })
  })
  it('maps a normalized bbox centre to pixel space', () => {
    // bbox [x,y,w,h] = [0.4,0.5,0.2,0.1] on a 1000x800 image → centre (0.5,0.55) → (500,440)
    expect(pointFromTarget({ bbox: [0.4, 0.5, 0.2, 0.1], imageW: 1000, imageH: 800 }))
      .toEqual({ xPx: 500, yPx: 440 })
  })
  it('returns null when a bbox is given without dimensions', () => {
    expect(pointFromTarget({ bbox: [0.4, 0.5, 0.2, 0.1] })).toBeNull()
  })
  it('returns null when nothing usable is given', () => {
    expect(pointFromTarget({})).toBeNull()
  })
})
