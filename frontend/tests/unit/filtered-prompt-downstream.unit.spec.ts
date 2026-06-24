import { describe, expect, it } from 'vitest'
import {
  collectKeepSet,
  collectKeepSetDownstream,
  buildFilteredWorkflow,
} from '~/composables/useFilteredPrompt'
import type { LiteGraphWorkflow } from '~/composables/useVueNodes'

// Link tuple shape: [linkId, originId, originSlot, targetId, targetSlot, type]
function wf(nodeIds: number[], links: number[][]): LiteGraphWorkflow {
  return {
    nodes: nodeIds.map((id) => ({ id, type: `T${id}` })),
    links,
  } as unknown as LiteGraphWorkflow
}

// Diamond:   1 → 2 → 4
//             \      /
//              → 3 →
// plus a side input 5 → 4 that is NOT downstream of the target.
const DIAMOND = wf(
  [1, 2, 3, 4, 5],
  [
    [10, 1, 0, 2, 0, '*'],
    [11, 1, 0, 3, 0, '*'],
    [12, 2, 0, 4, 0, '*'],
    [13, 3, 0, 4, 1, '*'],
    [14, 5, 0, 4, 2, '*'],
  ],
)

describe('collectKeepSetDownstream', () => {
  it('keeps the target and everything it transitively feeds', () => {
    const keep = collectKeepSetDownstream(DIAMOND, [2])
    expect(keep.has(2)).toBe(true) // target
    expect(keep.has(4)).toBe(true) // fed by 2
  })

  it('backfills the OTHER inputs of downstream nodes', () => {
    // 4 also consumes 3 (sibling branch) and 5 (side input). Both must be kept
    // or node 4 runs with dangling slots.
    const keep = collectKeepSetDownstream(DIAMOND, [2])
    expect(keep.has(3)).toBe(true) // sibling branch feeding 4
    expect(keep.has(5)).toBe(true) // unrelated side input feeding 4
  })

  it('backfills the target’s own upstream deps', () => {
    const keep = collectKeepSetDownstream(DIAMOND, [2])
    expect(keep.has(1)).toBe(true) // 2 depends on 1
  })

  it('from the root keeps the whole graph', () => {
    const keep = collectKeepSetDownstream(DIAMOND, [1])
    expect([...keep].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('from a leaf keeps only the leaf + its upstream (nothing downstream exists)', () => {
    const keep = collectKeepSetDownstream(DIAMOND, [4])
    // 4 feeds nothing; cone is just {4}, then backfill all of its inputs.
    expect([...keep].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('differs from the upstream walk on a mid-graph node', () => {
    // Upstream from 2 = {1, 2}. Downstream from 2 = {1,2,3,4,5}.
    const upstream = collectKeepSet(DIAMOND, [2])
    expect([...upstream].sort()).toEqual([1, 2])
    const downstream = collectKeepSetDownstream(DIAMOND, [2])
    expect(downstream.size).toBeGreaterThan(upstream.size)
  })
})

describe('buildFilteredWorkflow direction', () => {
  it('downstream strips nodes outside the cone+backfill and prunes their links', () => {
    // Add an isolated branch 6 → 7 that is neither up nor downstream of 2.
    const graph = wf(
      [1, 2, 3, 4, 5, 6, 7],
      [
        [10, 1, 0, 2, 0, '*'],
        [11, 1, 0, 3, 0, '*'],
        [12, 2, 0, 4, 0, '*'],
        [13, 3, 0, 4, 1, '*'],
        [14, 5, 0, 4, 2, '*'],
        [20, 6, 0, 7, 0, '*'],
      ],
    )
    const out = buildFilteredWorkflow(graph, [2], 'downstream')
    const keptIds = (out.nodes as any[]).map((n) => n.id).sort()
    expect(keptIds).toEqual([1, 2, 3, 4, 5]) // 6 and 7 dropped
    // No surviving link references a dropped node.
    for (const l of out.links as any[]) {
      expect([1, 2, 3, 4, 5]).toContain(Number(l[1]))
      expect([1, 2, 3, 4, 5]).toContain(Number(l[3]))
    }
  })

  it('defaults to the upstream walk when direction is omitted', () => {
    const out = buildFilteredWorkflow(DIAMOND, [2])
    const keptIds = (out.nodes as any[]).map((n) => n.id).sort()
    expect(keptIds).toEqual([1, 2])
  })
})
