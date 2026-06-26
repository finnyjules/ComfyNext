import { describe, it, expect } from 'vitest'
import { getEffect } from '~/lib/spacetype/effects'

describe('cylinder controls', () => {
  const cyl = getEffect('cylinder')
  const ctrl = (k: string) => cyl.controls.find(c => c.key === k) as any
  it('has a ringRepeat slider (Ribbon group, default 1)', () => {
    const c = ctrl('ringRepeat')
    expect(c).toBeTruthy()
    expect(c.kind).toBe('slider'); expect(c.group).toBe('Ribbon')
    expect(c.min).toBe(1); expect(c.max).toBe(8); expect(c.step).toBe(1); expect(c.default).toBe(1)
  })
  it('spin speed steps by 0.05', () => {
    expect(ctrl('spinSpeed').step).toBe(0.05)
  })
})
