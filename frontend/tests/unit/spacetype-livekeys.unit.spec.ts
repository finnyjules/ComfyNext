import { describe, it, expect } from 'vitest'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('effect liveKeys', () => {
  it('every liveKey is an actual control key on that effect', () => {
    for (const e of SPACE_TYPE_EFFECTS) {
      if (!e.liveKeys) continue
      const keys = new Set(e.controls.map(c => c.key))
      for (const lk of e.liveKeys) {
        expect(keys.has(lk), `${e.id}.liveKeys → ${lk} is not a declared control`).toBe(true)
      }
    }
  })
})
