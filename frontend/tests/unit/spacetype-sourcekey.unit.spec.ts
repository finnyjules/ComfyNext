import { describe, it, expect } from 'vitest'
import { spaceTypeSourceKey } from '../../app/lib/spacetype/sourceKey'

const base = { effectId: 'ribbon', params: { rows: 11, text: 'VESSEL' }, fps: 30, loopDuration: 4, W: 1280, H: 720 }

describe('spaceTypeSourceKey', () => {
  it('is stable for the same input', () => {
    expect(spaceTypeSourceKey(base)).toBe(spaceTypeSourceKey({ ...base }))
  })
  it('changes when any param changes', () => {
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, params: { rows: 12, text: 'VESSEL' } }))
  })
  it('changes when dims or fps change', () => {
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, W: 1920 }))
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, fps: 24 }))
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, H: 1080 }))
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, loopDuration: 6 }))
  })
  it('is param-order independent', () => {
    const a = spaceTypeSourceKey({ ...base, params: { rows: 11, text: 'VESSEL' } })
    const b = spaceTypeSourceKey({ ...base, params: { text: 'VESSEL', rows: 11 } })
    expect(a).toBe(b)
  })
})
