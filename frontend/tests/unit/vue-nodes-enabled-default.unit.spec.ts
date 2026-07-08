import { describe, expect, it } from 'vitest'
import { vueNodesDefault } from '~/composables/useVueNodesEnabled'

describe('vueNodesDefault', () => {
  it('is ON when the setting was never touched', () => {
    expect(vueNodesDefault(null)).toBe(true)
  })
  it('respects an explicit off', () => {
    expect(vueNodesDefault('false')).toBe(false)
  })
  it('stays on for the legacy explicit true', () => {
    expect(vueNodesDefault('true')).toBe(true)
  })
})
