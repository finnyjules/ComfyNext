import { describe, it, expect } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import { postSettingsFromParams } from '~/lib/texturefx/types'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('texture post adoption', () => {
  it('exposes the post controls without ambient occlusion', () => {
    const keys = TEXTURE_CONTROLS.map(c => c.key)
    expect(keys).toContain('post.bloom')
    expect(keys).toContain('post.vignette')
    expect(keys.some(k => k.startsWith('post.gtao'))).toBe(false)
  })

  it('defaults post to off for a config saved before the change (missing post.* keys)', () => {
    // Simulates a legacy saved node: no post.* keys present at all.
    const legacy = postSettingsFromParams({ mode: 'procedural' })
    expect(legacy).toEqual(DEFAULT_POST)
  })

  it('preserves post settings that are already present', () => {
    const p = { ...textureDefaults(), 'post.bloom': true, 'post.bloomStrength': 0.9 }
    const post = postSettingsFromParams(p)
    expect(post.bloom).toBe(true)
    expect(post.bloomStrength).toBe(0.9)
    // Untouched keys still fall back to DEFAULT_POST.
    expect(post.vignette).toBe(DEFAULT_POST.vignette)
  })

  it('textureDefaults() includes every post.* control default (flat Params merge point)', () => {
    const d = textureDefaults()
    expect(d['post.bloom']).toBe(false)
    expect(d['post.vignette']).toBe(false)
  })
})
