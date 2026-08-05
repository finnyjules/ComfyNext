import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/shapefx/config'
import { postNeeded } from '~/lib/shapefx/post'

// Shape's retired formula used a 0.5 coefficient on a 0-100 slider; Gradient's
// canonical shared formula (post_grain.frag) uses 0.16 on a 0-1 amount. The
// task brief's own SHAPE_TO_CANONICAL (0.5/0.16) assumes style.grain is
// already 0-1 — it is actually 0-100 (see shapefx/controls.ts's
// `slider('style.grain', 'Grain', 0, 100, 1, ...)` and shapefx/engine.ts's
// `(cfg.style.grain ?? 0) / 100` before it ever reaches the shader) — so the
// full rescale divides by 100 first.
const SHAPE_TO_CANONICAL = 0.5 / 0.16

describe('grain migration', () => {
  it('carries a gradient doc through unchanged (0.16 is canonical) and pins grainSize to 1 (the size-quantisation trap)', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [], relief: { grain: 0.4 } } as never)
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo(0.4, 5)
    // post_grain.frag's cell-quantisation is bit-exact only at grainSize <= 1;
    // DEFAULT_POST.grainSize is 2, which would render every migrated document
    // visibly coarser than it looked before this change.
    expect(cfg.post.grainSize).toBe(1)
    // Consumed, not left around to double-migrate (and re-clobber a later
    // manual edit to post.grainAmount) on the next ensureConfigDefaults pass.
    expect(cfg.relief.grain).toBeUndefined()
  })

  it('rescales a shape doc (0-100 raw scale) so it renders as before, and pins grainSize to 1', () => {
    const cfg = mergeConfig({ style: { grain: 20 } } as never)
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo((20 / 100) * SHAPE_TO_CANONICAL, 5)
    expect(cfg.post.grainSize).toBe(1)
  })

  it('clamps rather than exceeding the slider range', () => {
    const cfg = mergeConfig({ style: { grain: 90 } } as never)
    expect(cfg.post.grainAmount).toBeLessThanOrEqual(1)
    expect(cfg.post.grainAmount).toBe(1)
  })

  it('leaves post.grain off when the old doc explicitly had no grain', () => {
    expect(ensureConfigDefaults({ canvas: {}, layers: [], relief: { grain: 0 } } as never).post.grain).toBe(false)
    expect(mergeConfig({ style: { grain: 0 } } as never).post.grain).toBe(false)
  })

  it('a doc that never carried legacy relief.grain is untouched — no double-migration, no forced coarsening of an unrelated document', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [] } as never)
    expect(cfg.post.grain).toBe(false)
    expect(cfg.post.grainAmount).toBe(0.25)   // DEFAULT_POST, untouched
    expect(cfg.post.grainSize).toBe(2)        // DEFAULT_POST, untouched — NOT force-pinned
  })

  // Shape's style.grain is NOT deleted by the migration the way Gradient's
  // relief.grain is (see gradientfx/types.ts) — an omitted style entirely falls
  // back to DEFAULT_CONFIG's own grain default (20, unchanged since before this
  // task: every brand-new shape has always opened with a touch of grain), so
  // that default keeps rendering exactly as it always did, now realized through
  // the shared post stack instead of the retired uGrain uniform.
  it('an omitted style falls back to DEFAULT_CONFIG\'s own grain default, not off', () => {
    const cfg = mergeConfig({ style: {} } as never)
    expect(cfg.style.grain).toBe(DEFAULT_CONFIG.style.grain)
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo((DEFAULT_CONFIG.style.grain! / 100) * SHAPE_TO_CANONICAL, 5)
  })

  // The linchpin of Shape's pixel-fidelity result (see post.ts's postNeeded doc
  // comment): style.grain must keep routing a config through the engine's
  // offscreen post pass exactly as it did before Task 8, even though that pass
  // no longer does anything WITH grain — dropping style.grain from this check
  // would silently move every existing grain-bearing document onto a DIFFERENT
  // render path (no MSAA on that pass's render target vs. the canvas's own
  // antialiasing), independent of and unrelated to grain's own pixels. Verified
  // empirically: a representative fixture rendered 65536/65536 bytes identical
  // at 128px WITH this coupling kept, and ~40/255 mean pixel diff WITHOUT it.
  it('style.grain alone (no distortion) still marks the post pass needed, for render-path parity', () => {
    const cfg = mergeConfig({ style: { grain: 20, distortion: 0 } } as never)
    expect(postNeeded(cfg)).toBe(true)
  })
  it('with both grain and distortion at zero, the post pass is skipped entirely', () => {
    const cfg = mergeConfig({ style: { grain: 0, distortion: 0 } } as never)
    expect(postNeeded(cfg)).toBe(false)
  })
})
