import { describe, it, expect } from 'vitest'
import { applyDraftOverrides, draftUsdExprFor, DRAFT_RULES } from '~/lib/draft/overrides'

function vnode(id: string, nodeType: string, defs: string[], values: any[]) {
  return { id, data: { nodeType, widgetDefs: defs.map(name => ({ name })), widgetsValues: values } }
}
function wfNode(id: number, type: string, widgets_values: any[]) {
  return { id, type, widgets_values }
}

describe('applyDraftOverrides', () => {
  it('swaps GenerateImageNode to flux-schnell and merges megapixels into model_options', () => {
    const wf = { nodes: [wfNode(1, 'GenerateImageNode', ['flux-pro', 'a cat', '1:1', 42, '{"guidance":3}'])] }
    const vnodes = [vnode('1', 'GenerateImageNode', ['model', 'prompt', 'aspect_ratio', 'seed', 'model_options'], ['flux-pro', 'a cat', '1:1', 42, '{"guidance":3}'])]
    const res = applyDraftOverrides(wf, vnodes)
    expect(res.overriddenIds).toEqual(['1'])
    expect(wf.nodes[0].widgets_values[0]).toBe('flux-schnell')
    // JSON widget merged, existing keys preserved
    expect(JSON.parse(wf.nodes[0].widgets_values[4])).toEqual({ guidance: 3, megapixels: '0.5' })
    // prompt / aspect / seed untouched
    expect(wf.nodes[0].widgets_values[1]).toBe('a cat')
    expect(wf.nodes[0].widgets_values[3]).toBe(42)
    // restore snapshot carries the originals
    expect(res.restoreById['1']).toEqual({ model: 'flux-pro', model_options: '{"guidance":3}' })
  })

  it('drafts FluxLoRARemoteNode by steps+megapixels and NEVER touches the model/lora widgets', () => {
    const defs = ['prompt', 'lora_name', 'num_inference_steps', 'megapixels', 'seed']
    const wf = { nodes: [wfNode(2, 'FluxLoRARemoteNode', ['hero shot', 'my-character', 28, '1', 7])] }
    const vnodes = [vnode('2', 'FluxLoRARemoteNode', defs, ['hero shot', 'my-character', 28, '1', 7])]
    const res = applyDraftOverrides(wf, vnodes)
    expect(wf.nodes[0].widgets_values[2]).toBe(8)
    expect(wf.nodes[0].widgets_values[3]).toBe('0.5')
    expect(wf.nodes[0].widgets_values[1]).toBe('my-character') // lora untouched
    expect(res.restoreById['2']).toEqual({ num_inference_steps: 28, megapixels: '1' })
  })

  it('leaves unmapped node types byte-identical', () => {
    const wf = { nodes: [wfNode(3, 'UpscaleImageNode', ['x2'])] }
    const before = JSON.stringify(wf)
    const res = applyDraftOverrides(wf, [vnode('3', 'UpscaleImageNode', ['factor'], ['x2'])])
    expect(res.overriddenIds).toEqual([])
    expect(JSON.stringify(wf)).toBe(before)
  })

  it('skips a mapped node whose widget defs are missing (no crash, no override)', () => {
    const wf = { nodes: [wfNode(4, 'GenerateImageNode', ['flux-pro'])] }
    const res = applyDraftOverrides(wf, [{ id: '4', data: { nodeType: 'GenerateImageNode' } }])
    expect(res.overriddenIds).toEqual([])
  })

  it('draftUsdExprFor returns a parseable price literal for mapped types, null otherwise', () => {
    expect(JSON.parse(draftUsdExprFor('GenerateImageNode')!)).toMatchObject({ type: 'usd', format: { approximate: true } })
    expect(draftUsdExprFor('UpscaleImageNode')).toBeNull()
    expect(Object.keys(DRAFT_RULES)).toEqual(['GenerateImageNode', 'FluxLoRARemoteNode'])
  })
})
