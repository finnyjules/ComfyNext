import { describe, expect, it } from 'vitest'
import { walkShaderChain } from '~/lib/shaderfx/chain'

function node(id: string, nodeType: string, extra: any = {}) {
  return { id, data: { nodeType, widgetsValues: [], widgetDefs: [], images: [], ...extra } }
}
const edge = (source: string, target: string) => ({ source, target, targetHandle: 'input-0' })

const shaderDefs = [
  { name: 'effect' }, { name: 'params' }, { name: 'time' }, { name: 'duration' }, { name: 'fps' }, { name: 'seed' },
]
function shaderNode(id: string, effect: string, params = '{}', images: string[] = []) {
  return node(id, 'ShaderEffect', { widgetDefs: shaderDefs, widgetsValues: [effect, params, 0, 0, 24, 42], images })
}

describe('walkShaderChain', () => {
  it('single node, image upstream', () => {
    const nodes = [shaderNode('b', 'halftone'), node('a', 'PreviewImage', { images: ['/view?x=1'] })]
    const r = walkShaderChain('b', nodes, [edge('a', 'b')])
    expect(r.passes.map(p => p.effectId)).toEqual(['halftone'])
    expect(r.baseUrl).toBe('/view?x=1')
    expect(r.nodeIds).toEqual(['a'])
  })

  it('stacks unexecuted upstream ShaderEffects in order', () => {
    const nodes = [
      shaderNode('c', 'halftone'),
      shaderNode('b', 'noise_distortion', '{"u_amount":0.1}'),
      node('a', 'LoadImage', { widgetsValues: ['cat.png'] }),
    ]
    const r = walkShaderChain('c', nodes, [edge('b', 'c'), edge('a', 'b')])
    expect(r.passes.map(p => p.effectId)).toEqual(['noise_distortion', 'halftone'])
    expect(r.passes[0]!.params).toEqual({ u_amount: 0.1 })
    expect(r.baseUrl).toContain('cat.png')
    expect(r.nodeIds).toEqual(['b', 'a'])
  })

  it('an executed upstream ShaderEffect terminates the walk with its output image', () => {
    const nodes = [shaderNode('c', 'halftone'), shaderNode('b', 'noise_distortion', '{}', ['/view?out=b'])]
    const r = walkShaderChain('c', nodes, [edge('b', 'c')])
    expect(r.passes.map(p => p.effectId)).toEqual(['halftone'])
    expect(r.baseUrl).toBe('/view?out=b')
  })

  it('resolves an upstream Image artifact node (pasted image) via its image widget', () => {
    const nodes = [
      shaderNode('b', 'halftone'),
      node('a', 'Image', { widgetDefs: [{ name: 'label' }, { name: 'image' }], widgetsValues: ['x', 'pasted.png'] }),
    ]
    const r = walkShaderChain('b', nodes, [edge('a', 'b')])
    expect(r.baseUrl).toContain('filename=pasted.png')
    expect(r.baseUrl).toContain('type=input')
  })

  it('cycles and missing edges terminate safely', () => {
    const nodes = [shaderNode('a', 'halftone'), shaderNode('b', 'halftone')]
    const r = walkShaderChain('a', nodes, [edge('b', 'a'), edge('a', 'b')])
    expect(r.baseUrl).toBeNull()
    expect(r.passes.length).toBeGreaterThan(0)
  })
})
