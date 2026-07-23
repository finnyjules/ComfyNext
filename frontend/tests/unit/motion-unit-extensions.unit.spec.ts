import { describe, it, expect } from 'vitest'
import type { UnitState, UnitCopy } from '~/lib/motion/evaluate'
import { IDENTITY_UNIT } from '~/lib/motion/evaluate'

describe('UnitState extensions', () => {
  it('accepts scaleX/scaleY and copies (types compile, identity has none)', () => {
    const copy: UnitCopy = { dx: 1, dy: 0, scale: 1.2, opacity: 0.5 }
    const st: UnitState = { ...IDENTITY_UNIT, scaleX: 0.5, scaleY: 1, copies: [copy] }
    expect(st.scaleX).toBe(0.5)
    expect(st.copies).toHaveLength(1)
    expect((IDENTITY_UNIT as UnitState).scaleX).toBeUndefined()
  })
})
