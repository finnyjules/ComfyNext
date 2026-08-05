import { describe, it, expect } from 'vitest'
import { postNeeded, POST_FRAG, POST_VERT } from '../../app/lib/shapefx/post'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cfg = (style: Partial<typeof DEFAULT_CONFIG.style>): any =>
  mergeConfig({ ...structuredClone(DEFAULT_CONFIG), style: { ...DEFAULT_CONFIG.style, ...style } })

describe('postNeeded', () => {
  it('is false when both grain and distortion are off, so the pass can be skipped entirely', () => {
    expect(postNeeded(cfg({ grain: 0, distortion: 0 }))).toBe(false)
  })
  it('is true when distortion is on', () => {
    expect(postNeeded(cfg({ grain: 0, distortion: 35 }))).toBe(true)
  })
  it('treats a hair above zero as on, matching the shader guard', () => {
    expect(postNeeded(cfg({ grain: 0, distortion: 0.5 }))).toBe(true)
  })
  // Task 8: grain's own NOISE is retired from this pass — moved into the shared
  // post stack (see config.ts's mergeConfig migration) — but style.grain still
  // counts toward "needed" here, deliberately, for a reason that has nothing to
  // do with grain's pixels: it keeps a grain-bearing document routed through the
  // SAME render path (this offscreen pass) it always was, so its appearance
  // doesn't shift for an unrelated reason (see post.ts's postNeeded doc comment
  // for the full story — verified empirically against a live render).
  it('style.grain alone still marks the pass needed, for render-path parity', () => {
    expect(postNeeded(cfg({ grain: 90, distortion: 0 }))).toBe(true)
  })
})

describe('post shader source', () => {
  it('declares every uniform the engine sets', () => {
    for (const u of ['uScene', 'uDistort', 'uResolution', 'uSeed']) {
      expect(POST_FRAG, `missing uniform ${u}`).toContain(u)
    }
  })
  // Task 8: grain (and its hashGrain hash) retired from this shader entirely —
  // it duplicated gradientfx/shaders.ts's own copy at a different (3x-stronger)
  // coefficient despite a comment here once claiming the two matched. The
  // shared post stack's post_grain.frag is now the only grain implementation.
  it('no longer carries a grain implementation of its own', () => {
    expect(POST_FRAG).not.toContain('uGrain')
    expect(POST_FRAG).not.toContain('hashGrain')
  })
  it('guards distortion so a zero value is a true no-op inside the shader', () => {
    expect(POST_FRAG).toMatch(/uDistort\s*>\s*0\.0/)
  })
  it('preserves alpha rather than forcing opaque, so transparent exports survive', () => {
    // A `vec4(col, 1.0)` here would turn every transparent background black.
    // Asserted POSITIVELY (the alpha argument IS the source's own alpha) rather
    // than as a "no vec4(..., 1.0)" search: the negative form false-positived the
    // moment the colour argument became an inline `clamp(src.rgb, 0.0, 1.0)`,
    // whose own trailing `, 1.0)` the pattern could not tell from the alpha slot.
    expect(POST_FRAG).toMatch(/gl_FragColor\s*=\s*vec4\(.*,\s*src\.a\s*\)\s*;/)
  })
  it('has a vertex shader that passes UVs through', () => {
    expect(POST_VERT).toContain('vUv')
  })
})

describe('every render path goes through drawFrame', () => {
  const src = readFileSync(resolve(__dirname, '../../app/lib/shapefx/engine.ts'), 'utf8')

  it('draws the main scene from exactly one place', () => {
    // render() and frameToBlob() must both route through drawFrame(). They used to each
    // call renderer.render() directly, which is exactly how the preview and the bake
    // drifted apart — grain and distortion reached one and not the other.
    const direct = src.match(/this\.renderer\.render\(this\.scene, this\.cam\)/g) ?? []
    expect(direct.length, 'scene should be drawn only inside renderScene()').toBe(1)
  })

  it('routes both public render entry points through drawFrame', () => {
    // Guards the other half: a future path could call renderScene() directly and skip
    // the post chain entirely, which the count above would not catch.
    // Anchor on the METHOD DECLARATIONS, not the first textual mention — the doc
    // comment above drawFrame() names both by design.
    for (const decl of [/\n  render\(orbit[^\n]*\{/, /\n  async frameToBlob\([^\n]*\{/]) {
      const m = decl.exec(src)
      expect(m, `declaration ${decl} not found`).not.toBeNull()
      const body = src.slice(m!.index, m!.index + 900)
      expect(body, `${decl} should call drawFrame()`).toContain('this.drawFrame()')
    }
  })
})
