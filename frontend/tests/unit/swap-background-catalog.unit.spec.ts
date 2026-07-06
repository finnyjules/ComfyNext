import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Swap Background node registration', () => {
  it('has an action-catalog entry (edit intent, Nano Banana 2)', () => {
    const e = ACTION_CATALOG.SwapBackgroundNode
    expect(e).toBeDefined()
    expect(e.intent).toBe('edit')
    expect(e.model).toBe('Nano Banana 2')
  })
  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.SwapBackgroundNode).toBeDefined()
  })
  it('is branded Gemini', () => {
    expect(NODE_MODEL_BRAND.SwapBackgroundNode).toBe('Gemini')
  })
})
