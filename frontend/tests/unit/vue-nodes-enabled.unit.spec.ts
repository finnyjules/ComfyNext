import { describe, it, expect } from 'vitest'
import { vueNodesDefault, vueNodesResolved } from '~/composables/useVueNodesEnabled'

// The Vue canvas is the default renderer; only an explicit 'false' written by
// the Settings toggle picks the legacy LiteGraph/bridge path.
describe('vueNodesDefault', () => {
  it('defaults ON when nothing is stored', () => {
    expect(vueNodesDefault(null)).toBe(true)
  })

  it("disables only on the literal 'false'", () => {
    expect(vueNodesDefault('false')).toBe(false)
  })

  it('stays on for anything else', () => {
    expect(vueNodesDefault('true')).toBe(true)
    expect(vueNodesDefault('FALSE')).toBe(true)
    expect(vueNodesDefault('')).toBe(true)
  })
})

// Hosted mode has no LiteGraph canvas at all: the bridge iframe is deliberately
// not mounted (mounting it is the hole that let the browser post to the engine
// unmetered), so the legacy branch waits 120s on a bridge that never becomes
// ready and leaves the user on a permanently empty canvas. The stored toggle
// must not be able to reach that branch.
describe('vueNodesResolved', () => {
  it('hosted forces the Vue canvas ON regardless of the stored setting', () => {
    expect(vueNodesResolved('false', true)).toBe(true)
    expect(vueNodesResolved(null, true)).toBe(true)
    expect(vueNodesResolved('garbage', true)).toBe(true)
  })

  it('local keeps the stored setting exactly as before', () => {
    expect(vueNodesResolved(null, false)).toBe(true)
    expect(vueNodesResolved('true', false)).toBe(true)
    expect(vueNodesResolved('false', false)).toBe(false)
    expect(vueNodesResolved('garbage', false)).toBe(true)
  })
})
