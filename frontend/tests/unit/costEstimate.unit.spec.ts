import { describe, it, expect } from 'vitest'
import { estimateUsdForNodes, isReplicateBilled, type EstimateInputNode } from '~/lib/costEstimate'

const USD_05 = '{"type":"usd","usd":0.05,"format":{"approximate":true}}'
const USD_04 = '{"type":"usd","usd":0.04}'

describe('isReplicateBilled', () => {
  it('counts *RemoteNode classes', () => {
    expect(isReplicateBilled({ id: '1', type: 'FluxProRemoteNode' })).toBe(true)
  })
  it('counts comfy_extras Replicate wrappers by their …/Replicate category', () => {
    expect(isReplicateBilled({ id: '1', type: 'PersonSwap', category: 'api node/image/Replicate' })).toBe(true)
    expect(isReplicateBilled({ id: '2', type: 'PoseMannequin', category: 'api node/image/Replicate' })).toBe(true)
  })
  it('excludes credit-billed stock API nodes (OpenAI, Kling, …)', () => {
    expect(isReplicateBilled({ id: '1', type: 'OpenAIImage', category: 'api node/image/OpenAI' })).toBe(false)
    expect(isReplicateBilled({ id: '2', type: 'KlingVideo', category: 'api node/video/Kling' })).toBe(false)
  })
})

describe('estimateUsdForNodes', () => {
  it('tallies a Person Swap node that is not name-suffixed RemoteNode', () => {
    const nodes: EstimateInputNode[] = [
      { id: '1', type: 'PersonSwap', title: 'Person Swap', category: 'api node/image/Replicate', badgeExpr: USD_05 },
    ]
    const est = estimateUsdForNodes(nodes)
    expect(est).not.toBeNull()
    expect(est!.usd).toBeCloseTo(0.05)
    expect(est!.breakdown).toHaveLength(1)
  })

  it('sums Person Swap alongside a RemoteNode', () => {
    const nodes: EstimateInputNode[] = [
      { id: '1', type: 'FluxProRemoteNode', badgeExpr: USD_04 },
      { id: '2', type: 'PersonSwap', category: 'api node/image/Replicate', badgeExpr: USD_05 },
    ]
    expect(estimateUsdForNodes(nodes)!.usd).toBeCloseTo(0.09)
  })

  it('includes credit-billed stock API nodes in the estimate', () => {
    const nodes: EstimateInputNode[] = [
      { id: '1', type: 'OpenAIImage', category: 'api node/image/OpenAI', badgeExpr: USD_04 },
    ]
    const est = estimateUsdForNodes(nodes)
    expect(est).not.toBeNull()
    expect(est!.usd).toBeCloseTo(0.04)
    expect(est!.breakdown[0]!.credits).toBe(true)
  })
})

describe('credit-billed API nodes', () => {
  const kling = {
    id: '9',
    type: 'KlingTextToVideoNode',
    category: 'api node/video/Kling',
    // Real shape: a JSONata expr whose branches are {"type":"usd","usd":N} literals.
    badgeExpr: '($m := widgets.mode; $contains($m,"10") ? {"type":"usd","usd":0.7} : {"type":"usd","usd":0.35})',
  }
  it('includes api-node categories in the estimate as an approximate floor', () => {
    const est = estimateUsdForNodes([kling])
    expect(est).not.toBeNull()
    expect(est!.usd).toBeCloseTo(0.7)
    expect(est!.approximate).toBe(true)
    expect(est!.breakdown[0]!.credits).toBe(true)
    expect(est!.breakdown[0]!.label).toContain('(credits)')
  })
  it('still excludes unpriced local nodes', () => {
    expect(estimateUsdForNodes([{ id: '1', type: 'LoadImage', category: 'image', badgeExpr: null }])).toBeNull()
  })
})
