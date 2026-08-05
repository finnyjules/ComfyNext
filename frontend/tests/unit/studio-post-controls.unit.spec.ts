import { describe, it, expect } from 'vitest'
import { POST_EFFECTS, POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'
import { postControls } from '~/lib/studio/post/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('post manifest', () => {
  it('declares the twelve effects', () => {
    expect(POST_EFFECTS).toHaveLength(12)
  })

  it('orders every effect exactly once in the chain', () => {
    expect([...POST_CHAIN_ORDER].sort()).toEqual(POST_EFFECTS.map(e => e.id).sort())
  })

  it('points every param at a real PostSettings key', () => {
    for (const e of POST_EFFECTS) {
      expect(DEFAULT_POST).toHaveProperty(e.enableKey)
      for (const p of e.params) expect(DEFAULT_POST).toHaveProperty(p.settingsKey)
    }
  })
})

describe('derived post controls', () => {
  it('emits a switch per effect plus a slider per param', () => {
    const cs = postControls({ threeD: true })
    const bloomSwitch = cs.find(c => c.key === 'post.bloom')
    expect(bloomSwitch?.kind).toBe('switch')
    const strength = cs.find(c => c.key === 'post.bloomStrength')
    expect(strength?.kind).toBe('slider')
    // Params live under the effect's own section, revealed by its switch.
    expect(strength?.group).toBe(bloomSwitch?.group)
    expect((strength as { showIf?: { key: string } }).showIf?.key).toBe('post.bloom')
  })

  it('withholds ambient occlusion from non-3D hosts', () => {
    const flat = postControls({ threeD: false }).map(c => c.key)
    expect(flat).not.toContain('post.gtao')
    expect(flat.some(k => k.startsWith('post.gtao'))).toBe(false)
    expect(postControls({ threeD: true }).map(c => c.key)).toContain('post.gtao')
  })

  it('defaults each control to the DEFAULT_POST value', () => {
    for (const c of postControls({ threeD: true })) {
      const key = c.key.slice('post.'.length) as keyof typeof DEFAULT_POST
      expect(c.default).toEqual(DEFAULT_POST[key])
    }
  })
})

// Controls are opt-OUT: a thirteenth effect silently grants itself agent access
// and motion targets. Freeze the derived set so that shows up in review.
describe('derived control surface', () => {
  it('matches the frozen snapshot', () => {
    expect(postControls({ threeD: true }).map(c => `${c.kind} ${c.key}`).sort()).toMatchSnapshot()
  })
})
