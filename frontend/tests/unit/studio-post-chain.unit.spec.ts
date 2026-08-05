import { describe, it, expect } from 'vitest'
import { activePasses } from '~/lib/studio/post/chain'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import { POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'

describe('post pass selection', () => {
  it('selects nothing when every effect is off', () => {
    expect(activePasses(DEFAULT_POST)).toEqual([])
  })

  it('selects only the enabled effects', () => {
    const passes = activePasses({ ...DEFAULT_POST, bloom: true, vignette: true })
    expect(passes.map(p => p.id)).toEqual(['bloom', 'vignette'])
  })

  it('emits passes in chain order regardless of which were switched on first', () => {
    const passes = activePasses({ ...DEFAULT_POST, grain: true, color: true, bloom: true })
    const ids = passes.map(p => p.id)
    const expected = POST_CHAIN_ORDER.filter(id => ids.includes(id))
    expect(ids).toEqual(expected)
  })

  it('never selects a 3D-only effect for a flat host', () => {
    const passes = activePasses({ ...DEFAULT_POST, gtao: true }, { threeD: false })
    expect(passes.map(p => p.id)).not.toContain('gtao')
  })
})
