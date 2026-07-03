import { describe, it, expect } from 'vitest'
import { ensureVarsInput } from '~/lib/collection/varsInput'

describe('ensureVarsInput', () => {
  it('adds a vars input to SmartLayout nodes once', () => {
    const node = { data: { nodeType: 'SmartLayout', inputs: [{ name: 'brand', type: 'STRING' }] } }
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
})
