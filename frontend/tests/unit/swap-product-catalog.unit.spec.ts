import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Swap Product node registration', () => {
  it('has an action-catalog entry (edit intent, Nano Banana 2)', () => {
    const entry = ACTION_CATALOG.SwapProductNode
    expect(entry).toBeDefined()
    expect(entry.intent).toBe('edit')
    expect(entry.model).toBe('Nano Banana 2')
  })

  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.SwapProductNode).toBeDefined()
  })

  it('is branded Gemini (Nano Banana)', () => {
    expect(NODE_MODEL_BRAND.SwapProductNode).toBe('Gemini')
  })
})
