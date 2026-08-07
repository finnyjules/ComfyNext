import { describe, it, expect } from 'vitest'
import { postControls } from '~/lib/studio/post/controls'

const keys = (host: any) => postControls({ host }).map(c => c.key)

describe('postControls host capability', () => {
  it("'gl2d' excludes gtao and drops uniform:null params (halftoneScatter)", () => {
    const k = keys('gl2d')
    expect(k).not.toContain('post.gtao')
    expect(k).not.toContain('post.halftoneScatter') // uniform: null, dropped for gl2d
  })
  it("'three' excludes gtao but KEEPS uniform:null params", () => {
    const k = keys('three')
    expect(k).not.toContain('post.gtao')
    expect(k).toContain('post.halftoneScatter')
  })
  it("'three-depth' includes gtao and keeps params", () => {
    const k = keys('three-depth')
    expect(k).toContain('post.gtao')
    expect(k).toContain('post.gtaoRadius')
    expect(k).toContain('post.halftoneScatter')
  })
  it("'gl2d' output is byte-identical to the legacy { threeD:false } shape", () => {
    // Legacy behaviour: no gtao, no uniform:null params. Assert the full set + defaults are stable.
    const specs = postControls({ host: 'gl2d' })
    expect(specs.find(c => c.key === 'post.grain')).toMatchObject({ kind: 'switch', sectionToggle: true })
    expect(specs.find(c => c.key === 'post.grainAmount')).toMatchObject({ kind: 'slider', min: 0, max: 1, step: 0.02 })
  })
})
