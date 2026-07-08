import { describe, it, expect } from 'vitest'
import { directExecutionDefault } from '~/composables/useDirectExecutionEnabled'

// Direct execution is a beta feature and defaults OFF: only the literal
// stored string 'true' (written by the Settings toggle) enables it. Every
// other stored value — 'false', null (never set), or garbage — stays off.
describe('directExecutionDefault', () => {
  it('defaults OFF when nothing is stored', () => {
    expect(directExecutionDefault(null)).toBe(false)
  })

  it("enables only on the literal 'true'", () => {
    expect(directExecutionDefault('true')).toBe(true)
  })

  it("stays off on 'false'", () => {
    expect(directExecutionDefault('false')).toBe(false)
  })

  it('stays off on garbage / unexpected values', () => {
    expect(directExecutionDefault('1')).toBe(false)
    expect(directExecutionDefault('TRUE')).toBe(false)
    expect(directExecutionDefault('yes')).toBe(false)
    expect(directExecutionDefault('')).toBe(false)
  })
})
