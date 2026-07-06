import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Turntable node registration', () => {
  it('has an action-catalog entry (create intent)', () => {
    const e = ACTION_CATALOG.TurntableNode
    expect(e).toBeDefined()
    expect(e.intent).toBe('create')
  })
  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.TurntableNode).toBeDefined()
  })
  it('is branded Luma', () => {
    expect(NODE_MODEL_BRAND.TurntableNode).toBe('Luma')
  })
})
