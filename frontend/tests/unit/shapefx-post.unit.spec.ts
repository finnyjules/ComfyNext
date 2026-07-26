import { describe, it, expect } from 'vitest'
import { postNeeded, POST_FRAG, POST_VERT } from '../../app/lib/shapefx/post'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cfg = (style: Partial<typeof DEFAULT_CONFIG.style>): any =>
  mergeConfig({ ...structuredClone(DEFAULT_CONFIG), style: { ...DEFAULT_CONFIG.style, ...style } })

describe('postNeeded', () => {
  it('is false when both effects are off, so the pass can be skipped entirely', () => {
    expect(postNeeded(cfg({ grain: 0, distortion: 0 }))).toBe(false)
  })
  it('is true when either effect is on', () => {
    expect(postNeeded(cfg({ grain: 20, distortion: 0 }))).toBe(true)
    expect(postNeeded(cfg({ grain: 0, distortion: 35 }))).toBe(true)
  })
  it('treats a hair above zero as on, matching the shader guards', () => {
    expect(postNeeded(cfg({ grain: 0.5, distortion: 0 }))).toBe(true)
  })
})

describe('post shader source', () => {
  it('declares every uniform the engine sets', () => {
    for (const u of ['uScene', 'uGrain', 'uDistort', 'uResolution', 'uSeed']) {
      expect(POST_FRAG, `missing uniform ${u}`).toContain(u)
    }
  })
  it('reuses the shared grain hash rather than inventing another', () => {
    // Same function as gradientfx/shaders.ts so grain reads identically across studios.
    expect(POST_FRAG).toContain('hashGrain')
    expect(POST_FRAG).toContain('0.1031')   // the Dave Hoskins constant
  })
  it('guards each effect so a zero value is a true no-op inside the shader', () => {
    expect(POST_FRAG).toMatch(/uGrain\s*>\s*0\.0/)
    expect(POST_FRAG).toMatch(/uDistort\s*>\s*0\.0/)
  })
  it('preserves alpha rather than forcing opaque, so transparent exports survive', () => {
    // A `vec4(col, 1.0)` here would turn every transparent background black.
    expect(POST_FRAG).not.toMatch(/gl_FragColor\s*=\s*vec4\([^)]*,\s*1\.0\s*\)/)
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
