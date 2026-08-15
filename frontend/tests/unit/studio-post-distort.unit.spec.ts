import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
import { POST_EFFECTS, POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'
import catalog from '../../../shader_effects/manifest.json'

describe('shared post: distortion', () => {
  it('ships off by default and is a no-op until enabled', () => {
    expect(DEFAULT_POST.distort).toBe(false)
    expect(typeof DEFAULT_POST.distortAmount).toBe('number')
    expect(postEnabled({ ...DEFAULT_POST })).toBe(false)
  })

  it('postEnabled turns on when distort is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, distort: true })).toBe(true)
  })

  it('is registered in the effect manifest, chain order, and catalog', () => {
    expect(POST_EFFECTS.find(e => e.id === 'distort')?.frag).toBe('distort')
    expect(POST_CHAIN_ORDER).toContain('distort')
    // shader_effects/manifest.json is `{ version, effects: [...] }`, not a
    // record keyed by id — match that real shape rather than `catalog.distort`.
    const rec = (catalog as unknown as { effects: { id: string }[] }).effects.find(e => e.id === 'distort')
    expect(rec).toBeTruthy()
  })
})
