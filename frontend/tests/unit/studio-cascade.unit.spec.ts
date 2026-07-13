import { describe, it, expect } from 'vitest'
import {
  isStudioNode, isArtifactNode, planStudioCascade, planStudioUpstream,
  planStudiosToBakeForRun,
  type WalkNode, type WalkEdge,
} from '~/lib/studio/cascade'

// Chain: LoadImage → S1(shader) → A1(image) → S2(shader) → A2(image) [→ B(backend)]
const L: WalkNode = { id: 'L', type: 'comfy', data: { nodeType: 'LoadImage' } }
const S1: WalkNode = { id: 'S1', type: 'shader-studio', data: { nodeType: 'ShaderStudio' } }
const A1: WalkNode = { id: 'A1', type: 'artifact-image', data: { nodeType: 'Image' } }
const S2: WalkNode = { id: 'S2', type: 'shader-studio', data: { nodeType: 'ShaderStudio' } }
const A2: WalkNode = { id: 'A2', type: 'artifact-image', data: { nodeType: 'Image' } }
const B: WalkNode = { id: 'B', type: 'comfy', data: { nodeType: 'KSampler' } }

const baseNodes = [L, S1, A1, S2, A2]
const baseEdges: WalkEdge[] = [
  { source: 'L', target: 'S1', sourceHandle: 'output-0', targetHandle: 'input-0' },
  { source: 'S1', target: 'A1', sourceHandle: 'output-0', targetHandle: 'input-0' },
  { source: 'A1', target: 'S2', sourceHandle: 'output-0', targetHandle: 'input-0' },
  { source: 'S2', target: 'A2', sourceHandle: 'output-0', targetHandle: 'input-0' },
]

describe('studio node classification', () => {
  it('isStudioNode matches by vue-flow type or data.nodeType', () => {
    expect(isStudioNode(S1)).toBe(true)
    expect(isStudioNode({ id: 'x', data: { nodeType: 'TextureStudio' } })).toBe(true)
    expect(isStudioNode({ id: 'x', type: 'gradient-studio' })).toBe(true)
    expect(isStudioNode(A1)).toBe(false)
    expect(isStudioNode(L)).toBe(false)
    expect(isStudioNode(undefined)).toBe(false)
  })
  it('isArtifactNode matches artifact-* types only', () => {
    expect(isArtifactNode(A1)).toBe(true)
    expect(isArtifactNode(S1)).toBe(false)
    expect(isArtifactNode(B)).toBe(false)
  })
})

describe('planStudioCascade (downstream)', () => {
  it('collects the studio chain in order, through the image nodes', () => {
    const { studioOrder, hasBackendTail } = planStudioCascade('S1', baseNodes, baseEdges)
    expect(studioOrder).toEqual(['S1', 'S2'])
    expect(hasBackendTail).toBe(false)            // only studios + artifacts downstream
  })

  it('from a mid-chain studio, only that studio + downstream', () => {
    expect(planStudioCascade('S2', baseNodes, baseEdges).studioOrder).toEqual(['S2'])
  })

  it('flags a real backend node downstream of the final artifact', () => {
    const nodes = [...baseNodes, B]
    const edges = [...baseEdges, { source: 'A2', target: 'B', sourceHandle: 'output-0', targetHandle: 'input-0' }]
    const plan = planStudioCascade('S1', nodes, edges)
    expect(plan.studioOrder).toEqual(['S1', 'S2'])
    expect(plan.hasBackendTail).toBe(true)
  })

  it('a non-studio start still collects downstream studios (start itself excluded)', () => {
    expect(planStudioCascade('L', baseNodes, baseEdges).studioOrder).toEqual(['S1', 'S2'])
  })

  it('handles a branch — two studios fed by one artifact', () => {
    const S3: WalkNode = { id: 'S3', type: 'shader-studio', data: { nodeType: 'ShaderStudio' } }
    const nodes = [...baseNodes, S3]
    const edges = [...baseEdges, { source: 'A1', target: 'S3', sourceHandle: 'output-0', targetHandle: 'input-0' }]
    const order = planStudioCascade('S1', nodes, edges).studioOrder
    expect(order[0]).toBe('S1')
    expect(new Set(order)).toEqual(new Set(['S1', 'S2', 'S3']))
  })
})

describe('planStudioUpstream', () => {
  it('returns upstream studios first, ending with the target', () => {
    expect(planStudioUpstream('S2', baseNodes, baseEdges)).toEqual(['S1', 'S2'])
  })
  it('a chain head has only itself', () => {
    expect(planStudioUpstream('S1', baseNodes, baseEdges)).toEqual(['S1'])
  })
})

describe('planStudiosToBakeForRun', () => {
  // The reported bug: a run targeting an image node fed by a studio must bake
  // that studio first (the run strips it), else the image node runs null-input.
  it('bakes the studio upstream of a targeted image node', () => {
    expect(planStudiosToBakeForRun(['A1'], baseNodes, baseEdges)).toEqual(['S1'])
  })
  it('bakes a studio→studio chain head-first for a downstream target', () => {
    expect(planStudiosToBakeForRun(['A2'], baseNodes, baseEdges)).toEqual(['S1', 'S2'])
  })
  it('includes a target that is itself a studio', () => {
    expect(planStudiosToBakeForRun(['S2'], baseNodes, baseEdges)).toEqual(['S1', 'S2'])
  })
  it('dedupes studios shared across multiple targets', () => {
    expect(planStudiosToBakeForRun(['A1', 'A2'], baseNodes, baseEdges)).toEqual(['S1', 'S2'])
  })
  it('no targets → every studio, upstream-first', () => {
    expect(planStudiosToBakeForRun(undefined, baseNodes, baseEdges)).toEqual(['S1', 'S2'])
  })
  it('a target with no upstream studio bakes nothing', () => {
    expect(planStudiosToBakeForRun(['L'], baseNodes, baseEdges)).toEqual([])
  })
})
