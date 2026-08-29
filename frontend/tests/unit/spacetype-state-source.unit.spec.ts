import { describe, it, expect } from 'vitest'
import { nodeSpaceTypeStateSource } from '~/lib/spacetype/stateSource'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

function sampleState(over: Partial<SpaceTypeState> = {}): SpaceTypeState {
  return {
    effectId: 'cylinder',
    params: { text: 'NOIR' },
    gradientStops: [],
    fps: 30,
    loopDuration: 6,
    dimsKey: '16:9',
    transparent: true,
    bgColor: '#000000',
    ...over,
  }
}

describe('nodeSpaceTypeStateSource', () => {
  it('reads sailor_spaceType off the node, null when absent', () => {
    let node: any = { data: { properties: {} } }
    const src = nodeSpaceTypeStateSource(() => node)
    expect(src.read()).toBeNull()
    node.data.properties.sailor_spaceType = sampleState()
    expect(src.read()?.effectId).toBe('cylinder')
  })

  it('write persists onto the node and PRESERVES extra keys (thumb)', () => {
    const node: any = { data: { properties: { sailor_spaceType: { thumb: '/view?x' } } } }
    const src = nodeSpaceTypeStateSource(() => node)
    src.write(sampleState({ effectId: 'ribbon' }))
    const blob = node.data.properties.sailor_spaceType
    expect(blob.effectId).toBe('ribbon')
    expect(blob.thumb).toBe('/view?x') // extra key survived
  })

  it('read/write is a no-op-safe round trip when the node is missing', () => {
    const src = nodeSpaceTypeStateSource(() => undefined)
    expect(src.read()).toBeNull()
    expect(() => src.write(sampleState())).not.toThrow()
  })
})
