import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/shapefx/config'
import { SHAPE_CONTROLS, SHAPE_SECTIONS } from '~/lib/shapefx/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

// Task 7: Shape Studio adopts the shared post stack — same seam as Task 5
// (Gradient, gradientfx-post.unit.spec.ts) and Task 6 (Texture,
// texturefx-post.unit.spec.ts), against ShapeConfig's typed `post` field and
// mergeConfig's backfill (Shape's ensureConfigDefaults equivalent).
//
// Named `shapefx-post-adoption` rather than `shapefx-post` (the naming Task 5/6
// used) because `shapefx-post.unit.spec.ts` already exists and covers a DIFFERENT
// concern: Shape's own POST_FRAG grain/distortion pass (lib/shapefx/post.ts),
// landed before this task. That file is untouched by Task 7 — see engine.ts's
// drawFrame(), which keeps that pass and adds the shared stack after it.
describe('shape post adoption', () => {
  it('defaults post to off for a config saved before the change (missing post key entirely)', () => {
    const legacy = mergeConfig({ ...structuredClone(DEFAULT_CONFIG), post: undefined })
    expect(legacy.post).toEqual(DEFAULT_POST)
  })

  it('preserves post settings that are already present, backfilling only missing keys', () => {
    const cfg = mergeConfig({ ...structuredClone(DEFAULT_CONFIG), post: { bloom: true, bloomStrength: 0.9 } })
    expect(cfg.post.bloom).toBe(true)
    expect(cfg.post.bloomStrength).toBe(0.9)
    // Untouched keys still fall back to DEFAULT_POST.
    expect(cfg.post.vignette).toBe(DEFAULT_POST.vignette)
  })

  it('DEFAULT_CONFIG itself carries a post field already at rest (off)', () => {
    expect(DEFAULT_CONFIG.post).toEqual(DEFAULT_POST)
  })

  it('exposes the post controls without ambient occlusion (Shape has no depth/normal buffers wired)', () => {
    const keys = SHAPE_CONTROLS.map(c => c.key)
    expect(keys).toContain('post.bloom')
    expect(keys).toContain('post.vignette')
    expect(keys.some(k => k.startsWith('post.gtao'))).toBe(false)
  })

  it('the post sections land in SHAPE_SECTIONS so the schema-driven inspector renders them', () => {
    expect(SHAPE_SECTIONS).toContain('Bloom')
    expect(SHAPE_SECTIONS).toContain('Vignette')
  })
})
