import { describe, it, expect } from 'vitest'
import { applySceneToState, type Scene } from '~/lib/spacetype/scene'
import { defaultSpaceTypeState } from '~/lib/spacetype/state'

describe('applySceneToState', () => {
  it('applies look params but preserves base text/font', () => {
    const base = { ...defaultSpaceTypeState(), params: { text: 'KEEP', font: 'BaseFont', look: 1 } }
    const scene: Scene = { params: { text: 'HI', font: 'SceneFont', look: 9 }, projection: 'isometric', panX: 0.2, bgColor: '#123456' }
    const out = applySceneToState(base, scene)
    expect(out.params.text).toBe('KEEP')   // content preserved from base
    expect(out.params.font).toBe('BaseFont')
    expect(out.params.look).toBe(9)        // look replaced by the scene
    expect(out.projection).toBe('isometric')
    expect(out.panX).toBe(0.2)
    expect(out.bgColor).toBe('#123456')
  })
  it('leaves base fields when the scene omits them', () => {
    const base = { ...defaultSpaceTypeState(), bgColor: '#aaaaaa' }
    const out = applySceneToState(base, { params: { text: 'X' } })
    expect(out.bgColor).toBe('#aaaaaa')
    expect(out.fps).toBe(base.fps)
  })
})
