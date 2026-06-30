import { describe, expect, it } from 'vitest'
import {
  collectKeepSet,
  collectKeepSetDownstream,
  buildFilteredWorkflow,
  applyArtifactLocks,
  backfillStandaloneArtifactImages,
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

describe('applyArtifactLocks extraFrozenIds (auto-freeze upstream results)', () => {
  // 1 → 2 → 3 : freezing node 2 (an upstream artifact with a result) must drop the
  // 1→2 link so node 2 serializes as a leaf (loads its frozen image), keeping 2→3.
  it('strips incoming links of an extra-frozen node, keeps its outgoing link', () => {
    const w = wf([1, 2, 3], [[10, 1, 0, 2, 0, 'IMAGE'], [11, 2, 0, 3, 0, 'IMAGE']])
    const out = applyArtifactLocks(w, [], new Set([2]))
    const ids = (out.links as number[][]).map(l => l[0])
    expect(ids).not.toContain(10) // 1→2 dropped: node 2 is frozen (no upstream re-run)
    expect(ids).toContain(11)     // 2→3 kept: the frozen result still feeds downstream
  })
  it('is a no-op with no user locks and no extra-frozen ids', () => {
    const w = wf([1, 2], [[10, 1, 0, 2, 0, 'IMAGE']])
    expect((applyArtifactLocks(w, []).links as unknown[]).length).toBe(1)
  })
})

describe('backfillStandaloneArtifactImages feeds Image/Video/Audio loaders', () => {
  const oi = {
    Image: { input: { required: { image: [['', 'a.png'], {}] }, optional: {} } },
    Video: { input: { required: { video: [['', 'a.mp4'], {}] }, optional: {} } },
    Audio: { input: { required: { audio: [['', 'a.flac'], {}] }, optional: {} } },
  }
  const run = (type: string, data: any) => {
    const w = { nodes: [{ id: 1, type, widgets_values: [] }], links: [] } as any
    const out = backfillStandaloneArtifactImages(w, [{ id: 1, data: { nodeType: type, ...data } }], oi)
    return (out.nodes[0] as any).widgets_values[0]
  }
  it('feeds a standalone Video artifact its result (data.images[0]) into the video widget', () => {
    expect(run('Video', { images: ['/view?filename=clip.mp4&type=output'] })).toBe('clip.mp4 [output]')
  })
  it('feeds a standalone Audio artifact its result (data.audios[0]) into the audio widget', () => {
    expect(run('Audio', { audios: ['/view?filename=track.flac&type=output'] })).toBe('track.flac [output]')
  })
  it('still feeds Image artifacts (unchanged)', () => {
    expect(run('Image', { images: ['/view?filename=pic.png&type=output'] })).toBe('pic.png [output]')
  })
})

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
