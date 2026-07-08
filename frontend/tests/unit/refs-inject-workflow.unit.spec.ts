import { describe, it, expect } from 'vitest'
import { applyRefPromptTokens } from '../../app/lib/refs/injectWorkflow'
import { setRef, type RefRegistry } from '../../app/lib/refs/registry'

const reg: RefRegistry = setRef({}, 'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' })

describe('applyRefPromptTokens', () => {
  it('substitutes @name inside string widget values, in place', () => {
    const wf = { nodes: [{ type: 'CLIPTextEncode', widgets_values: ['man in @tracksuit', 20] }] }
    applyRefPromptTokens(wf, reg)
    expect(wf.nodes[0].widgets_values[0]).toBe('man in black Nike tracksuit')
    expect(wf.nodes[0].widgets_values[1]).toBe(20)
  })
  it('ignores non-string widget values and nodes without widgets_values', () => {
    const wf = { nodes: [{ type: 'X', widgets_values: [3, null, true] }, { type: 'Y' }] }
    expect(() => applyRefPromptTokens(wf, reg)).not.toThrow()
    expect(wf.nodes[0].widgets_values).toEqual([3, null, true])
  })
  it('tolerates an empty / missing nodes array', () => {
    expect(() => applyRefPromptTokens({}, reg)).not.toThrow()
    expect(() => applyRefPromptTokens({ nodes: [] }, reg)).not.toThrow()
  })
})
