import { describe, it, expect } from 'vitest'
import { getVueFlowType, ARTIFACT_NODE_COMPONENTS } from '../../app/composables/useVueNodes'

describe('ShotDirector registration', () => {
  it('maps the ShotDirector node type to the shot-director vue-flow component', () => {
    expect(ARTIFACT_NODE_COMPONENTS.ShotDirector).toBe('shot-director')
    expect(getVueFlowType('ShotDirector')).toBe('shot-director')
  })
})
