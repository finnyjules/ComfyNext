import { describe, it, expect } from 'vitest'
import { hostedModeEnabled } from '../../app/lib/hostedMode'

describe('hostedModeEnabled', () => {
  it('is true only for boolean true', () => {
    expect(hostedModeEnabled({ hostedMode: true })).toBe(true)
    expect(hostedModeEnabled({ hostedMode: false })).toBe(false)
    expect(hostedModeEnabled({})).toBe(false)
    expect(hostedModeEnabled({ hostedMode: 'true' })).toBe(false) // env leakage is not a yes
  })
})
