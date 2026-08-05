import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { GRADIENT_CONTROLS } from '~/lib/gradientfx/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('gradient post adoption', () => {
  it('defaults post to off on a config saved before the change', () => {
    const legacy = ensureConfigDefaults({ canvas: {}, layers: [] } as never)
    expect(legacy.post).toEqual(DEFAULT_POST)
  })

  it('preserves post that is already present', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [], post: { ...DEFAULT_POST, bloom: true } } as never)
    expect(cfg.post.bloom).toBe(true)
  })

  it('exposes the post controls without ambient occlusion', () => {
    const keys = GRADIENT_CONTROLS.map(c => c.key)
    expect(keys).toContain('post.bloom')
    expect(keys).toContain('post.vignette')
    expect(keys.some(k => k.startsWith('post.gtao'))).toBe(false)
  })
})
