import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults, resolvePost } from '~/lib/gradientfx/types'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/shapefx/config'
import { postNeeded } from '~/lib/shapefx/post'
import { reroll } from '~/lib/shapefx/randomize'
import { GRADIENT_FS, BLUR_FS } from '~/lib/gradientfx/shaders'
import { safeSeed } from '~/lib/studio/post/chain'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

// Shape's retired formula used a 0.5 coefficient on a 0-100 slider; Gradient's
// canonical shared formula (post_grain.frag) uses 0.16 on a 0-1 amount. The
// task brief's own SHAPE_TO_CANONICAL (0.5/0.16) assumes style.grain is
// already 0-1 — it is actually 0-100 (see the retired
// `slider('style.grain', 'Grain', 0, 100, 1, ...)` and shapefx/engine.ts's
// `(cfg.style.grain ?? 0) / 100` before it ever reached the shader) — so the
// full rescale divides by 100 first.
const SHAPE_TO_CANONICAL = 0.5 / 0.16

/** A Shape document exactly as it was saved before Task 8: a legacy style.grain,
 *  no `post` key at all. */
const legacyShapeDoc = (grain: number) => ({ seed: '#legacy01', style: { grain, distortion: 0, background: '#000000' } })

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
    const cfg = mergeConfig(legacyShapeDoc(20))
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo((20 / 100) * SHAPE_TO_CANONICAL, 5)
    expect(cfg.post.grainSize).toBe(1)
  })

  it('clamps rather than exceeding the slider range', () => {
    const cfg = mergeConfig(legacyShapeDoc(90))
    expect(cfg.post.grainAmount).toBeLessThanOrEqual(1)
    expect(cfg.post.grainAmount).toBe(1)
    // The documented ceiling: the rescale saturates at style.grain == 32, so
    // anything above that renders WEAKER than it did before. Pinned so the
    // trade-off stays visible rather than being rediscovered as a "bug".
    expect(mergeConfig(legacyShapeDoc(32)).post.grainAmount).toBe(1)
    expect(mergeConfig(legacyShapeDoc(31)).post.grainAmount).toBeLessThan(1)
  })

  it('leaves post.grain off when the old doc explicitly had no grain', () => {
    expect(ensureConfigDefaults({ canvas: {}, layers: [], relief: { grain: 0 } } as never).post.grain).toBe(false)
    expect(mergeConfig(legacyShapeDoc(0)).post.grain).toBe(false)
  })

  it('a doc that never carried legacy relief.grain is untouched — no double-migration, no forced coarsening of an unrelated document', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [] } as never)
    expect(cfg.post.grain).toBe(false)
    expect(cfg.post.grainAmount).toBe(0.25)   // DEFAULT_POST, untouched
    expect(cfg.post.grainSize).toBe(2)        // DEFAULT_POST, untouched — NOT force-pinned
  })

  // A brand-new Shape has nothing to migrate: DEFAULT_CONFIG carries no legacy
  // style.grain at all, so a fresh document ships with the shared stack's own
  // neutral grain defaults — but keeps the render path every shape has always used.
  it('a fresh shape config carries no legacy grain and no migration', () => {
    expect(DEFAULT_CONFIG.style.grain).toBeUndefined()
    const cfg = mergeConfig({ style: {} })
    expect(cfg.post.grain).toBe(false)
    expect(cfg.post.grainAmount).toBe(DEFAULT_POST.grainAmount)
    expect(cfg.post.grainSize).toBe(DEFAULT_POST.grainSize)
    // Render path unchanged for new documents — only the grain AMOUNT default moved.
    expect(cfg.forceOffscreenPass).toBe(true)
    expect(postNeeded(cfg)).toBe(true)
  })
})

// The defect this file exists to prevent a second time: the migration used to
// re-derive post grain from style.grain on EVERY mergeConfig — which is the load
// path — so a user's own edit to the shared Grain controls was silently reverted
// on reload, and (the old slider having been deleted) nothing could turn grain
// off at all.
describe('a migrated document is the user\'s to edit afterwards', () => {
  it('shape: a post-grain edit survives save -> reload -> save', () => {
    // 1. Load the legacy doc. It migrates.
    const loaded = mergeConfig(legacyShapeDoc(20))
    expect(loaded.post.grainAmount).toBeCloseTo(0.625, 5)
    // The legacy input is CONSUMED, not carried into what gets saved.
    expect(loaded.style.grain).toBeUndefined()

    // 2. The user drags Grain down and turns grainSize up; the studio saves.
    const saved = JSON.parse(JSON.stringify({ ...loaded, post: { ...loaded.post, grainAmount: 0.15, grainSize: 4 } }))

    // 3. Reload. The saved post wins — no re-derive.
    const reloaded = mergeConfig(saved)
    expect(reloaded.post.grainAmount).toBe(0.15)
    expect(reloaded.post.grainSize).toBe(4)

    // 4. And turning grain OFF sticks too (impossible before this fix).
    const off = mergeConfig(JSON.parse(JSON.stringify({ ...reloaded, post: { ...reloaded.post, grain: false } })))
    expect(off.post.grain).toBe(false)
  })

  it('shape: the render-path pin is frozen at migration and does NOT follow the grain amount', () => {
    const loaded = mergeConfig(legacyShapeDoc(20))
    expect(loaded.forceOffscreenPass).toBe(true)
    expect(postNeeded(loaded)).toBe(true)

    // Grain off, grain zero — the document still renders through the offscreen
    // pass it has always rendered through (no MSAA there vs. the canvas's own
    // antialias:true, so the path itself is visible). Decoupling the two is the
    // whole point of the pin.
    const off = mergeConfig(JSON.parse(JSON.stringify({ ...loaded, post: { ...loaded.post, grain: false, grainAmount: 0 } })))
    expect(off.forceOffscreenPass).toBe(true)
    expect(postNeeded(off)).toBe(true)

    // A document saved with grain explicitly at 0 never took that path, and still doesn't.
    const clean = mergeConfig(legacyShapeDoc(0))
    expect(clean.forceOffscreenPass).toBe(false)
    expect(postNeeded(clean)).toBe(false)
  })

  it('shape: re-rolling style does not resurrect the legacy field', () => {
    // rollStyle used to roll `grain: r.int(0, 45)`, which would have made the very
    // next load treat the document as un-migrated all over again.
    const loaded = mergeConfig(legacyShapeDoc(20))
    const edited = { ...loaded, post: { ...loaded.post, grainAmount: 0.15 } }
    const rolled = reroll(edited)
    expect(rolled.style.grain).toBeUndefined()
    expect(mergeConfig(JSON.parse(JSON.stringify(rolled))).post.grainAmount).toBe(0.15)
  })

  it('gradient: a saved post wins over a legacy relief.grain that is still present', () => {
    // ensureConfigDefaults deletes relief.grain, so a document that has been
    // through the studio once carries no migration input at all.
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [], relief: { grain: 0.4 } } as never)
    cfg.post.grainAmount = 0.15
    const reloaded = ensureConfigDefaults(JSON.parse(JSON.stringify(cfg)))
    expect(reloaded.post.grainAmount).toBe(0.15)
  })
})

// C2: ensureConfigDefaults runs on ONE runtime path (opening the studio). The
// node card, the render-cascade bake, the timeline/video StudioFrameSource and
// the embed all render straight off the raw saved blob. resolvePost is the
// derivation those paths share with the studio — renderer.ts's render() calls it.
describe('gradient migration reaches every render path, not just the studio', () => {
  it('resolvePost migrates a raw legacy blob that never met ensureConfigDefaults', () => {
    const raw = { canvas: {}, layers: [], relief: { grain: 0.4, relief: 0 } } as never
    const post = resolvePost(raw)
    expect(post.grain).toBe(true)
    expect(post.grainAmount).toBeCloseTo(0.4, 5)
    expect(post.grainSize).toBe(1)
  })

  it('resolvePost is pure — it does not mutate the caller\'s saved blob', () => {
    const raw = { canvas: {}, layers: [], relief: { grain: 0.4, relief: 0 } } as never
    const before = JSON.parse(JSON.stringify(raw))
    resolvePost(raw)
    expect(raw).toEqual(before)
  })

  it('resolvePost defaults post off for a blob with neither post nor legacy grain', () => {
    const post = resolvePost({ canvas: {}, layers: [], relief: { relief: 0 } } as never)
    expect(post.grain).toBe(false)
  })

  it('resolvePost and ensureConfigDefaults agree (they are the same derivation)', () => {
    const raw = { canvas: {}, layers: [], relief: { grain: 0.4, relief: 0 } } as never
    const viaRender = resolvePost(JSON.parse(JSON.stringify(raw)))
    const viaStudio = ensureConfigDefaults(JSON.parse(JSON.stringify(raw))).post
    expect(viaRender).toEqual(viaStudio)
  })
})

// C3: the retired formula was `col += g * u_grain * 0.16 * cover * midtone`,
// gated on `cover > 0.001` — "clean background". post_grain.frag gates on its own
// input alpha, and GRADIENT_FS hard-coded alpha to 1.0, so the gate had silently
// become a no-op: grain painted over the clean background of every layout with
// coverage below 1 (orbit/radial/stack with margin, innerRadius or gap). The
// pixel-level assertion lives in tests/studio-post-integration.spec.ts's
// "grain leaves zero-coverage background untouched" case (an ORBIT fixture — the
// only kind that can see this at all); these are the source-level guards.
describe('gradient carries shape coverage to the shared grain gate', () => {
  it('GRADIENT_FS writes coverage into alpha when u_coverAlpha is set', () => {
    expect(GRADIENT_FS).toContain('uniform float u_coverAlpha;')
    expect(GRADIENT_FS).toContain('u_coverAlpha > 0.5 ? cover : 1.0')
  })

  it('BLUR_FS forwards it, so the gate survives the soft-focus path too', () => {
    expect(BLUR_FS).toContain('uniform float u_coverAlpha;')
    expect(BLUR_FS).toContain('u_coverAlpha > 0.5 ? src.a : 1.0')
  })
})

// The seed invariant, moved from two call sites onto the shared boundary.
// post_grain.frag's hashGrain is a fract()-chain hash: a raw 32-bit string hash
// exceeds highp float's ~24-bit mantissa and every pixel collapses to the same
// value — the noise field becomes a flat colour wash.
describe('applyPost owns the seed magnitude invariant', () => {
  it('folds an unmodded 32-bit hash into the precision-safe range', () => {
    expect(safeSeed(4294967295)).toBeLessThan(10000)
    expect(safeSeed(3735928559)).toBeLessThan(10000)
  })

  it('leaves an already-small seed alone, so call-site fidelity pins still hold', () => {
    // gradientfx/renderer.ts pins `% 10000` and shapefx/engine.ts pins `% 1000`
    // to reproduce their retired in-shader grain's exact noise field; the
    // boundary must not perturb either.
    expect(safeSeed(9999)).toBe(9999)
    expect(safeSeed(999)).toBe(999)
    expect(safeSeed(42)).toBe(42)
  })

  it('survives negative and non-finite input instead of poisoning the uniform', () => {
    expect(safeSeed(-4294967295)).toBeGreaterThanOrEqual(0)
    expect(safeSeed(-4294967295)).toBeLessThan(10000)
    expect(safeSeed(Number.NaN)).toBe(42)
    expect(safeSeed(Number.POSITIVE_INFINITY)).toBe(42)
  })
})
