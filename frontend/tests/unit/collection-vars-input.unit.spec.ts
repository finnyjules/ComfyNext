import { describe, it, expect } from 'vitest'
import { ensureVarsInput, VARS_TARGET_NODE_TYPES } from '~/lib/collection/varsInput'

describe('ensureVarsInput', () => {
  it('adds a vars input to SmartLayout nodes once', () => {
    const node = { data: { nodeType: 'SmartLayout', inputs: [{ name: 'brand', type: 'STRING' }] } }
    ensureVarsInput(node as any)
    ensureVarsInput(node as any)
    const vars = node.data.inputs.filter((i: any) => i.name === 'vars')
    expect(vars).toHaveLength(1)
    expect(vars[0]).toMatchObject({ type: 'VARS', optional: true })
  })

  it.each([...VARS_TARGET_NODE_TYPES])('adds a vars input to studio type %s once', (nodeType) => {
    const node = { data: { nodeType, inputs: [] } }
    ensureVarsInput(node as any)
    ensureVarsInput(node as any)
    const vars = node.data.inputs.filter((i: any) => i.name === 'vars')
    expect(vars).toHaveLength(1)
    expect(vars[0]).toMatchObject({ type: 'VARS', optional: true })
  })

  it('ignores other node types', () => {
    const node = { data: { nodeType: 'Image', inputs: [] } }
    ensureVarsInput(node as any)
    expect(node.data.inputs).toHaveLength(0)
  })

  it('creates the inputs array when missing on a studio node', () => {
    const node = { data: { nodeType: 'SpaceType' } }
    ensureVarsInput(node as any)
    expect(node.data.inputs).toHaveLength(1)
    expect(node.data.inputs![0]).toMatchObject({ name: 'vars', type: 'VARS', optional: true })
  })
})
