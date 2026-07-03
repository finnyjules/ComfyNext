import { describe, expect, it } from 'vitest'
import { stripFrontendOnlyNodes } from '~/utils/stripFrontendOnlyNodes'
import { FRONTEND_ONLY_NODE_TYPES } from '~/lib/agent/capabilities'

// Link tuple shape: [linkId, originId, originSlot, targetId, targetSlot, type]
function wf(nodes: { id: number; type: string }[], links: number[][]) {
  return { nodes, links } as any
}

describe('stripFrontendOnlyNodes', () => {
  it('removes a frontend-only node and its dangling links, keeps backend nodes intact', () => {
    // 1 (Collection, frontend-only) → 2 (SmartLayout, backend) → 3 (Image, backend)
    const w = wf(
      [
        { id: 1, type: 'Collection' },
        { id: 2, type: 'SmartLayout' },
        { id: 3, type: 'Image' },
      ],
      [
        [10, 1, 0, 2, 0, 'VARS'],
        [11, 2, 0, 3, 0, 'IMAGE'],
      ],
    )

    const { workflow: out, removedTypes } = stripFrontendOnlyNodes(w, FRONTEND_ONLY_NODE_TYPES)

    expect(removedTypes).toEqual(['Collection'])
    expect((out.nodes as any[]).map(n => n.id).sort()).toEqual([2, 3])
    // Link touching the removed node (10: origin=1) is dropped; the backend
    // link (11: 2→3) survives untouched.
    expect((out.links as any[]).map(l => l[0])).toEqual([11])
  })

  it('is a no-op (same reference) when no frontend-only nodes are present', () => {
    const w = wf(
      [{ id: 1, type: 'KSampler' }, { id: 2, type: 'SaveImage' }],
      [[10, 1, 0, 2, 0, 'IMAGE']],
    )
    const { workflow: out, removedTypes } = stripFrontendOnlyNodes(w, FRONTEND_ONLY_NODE_TYPES)
    expect(removedTypes).toEqual([])
    expect(out).toBe(w)
  })

  it('does not mutate the input workflow', () => {
    const w = wf(
      [{ id: 1, type: 'GradientStudio' }, { id: 2, type: 'Image' }],
      [[10, 1, 0, 2, 0, 'IMAGE']],
    )
    const before = JSON.parse(JSON.stringify(w))
    stripFrontendOnlyNodes(w, FRONTEND_ONLY_NODE_TYPES)
    expect(w).toEqual(before)
  })

  it('strips multiple frontend-only node types in one pass (Collection + SpaceType + LipSyncStudio)', () => {
    const w = wf(
      [
        { id: 1, type: 'Collection' },
        { id: 2, type: 'SpaceType' },
        { id: 3, type: 'LipSyncStudio' },
        { id: 4, type: 'Compositor' },
      ],
      [
        [10, 1, 0, 4, 0, 'VARS'],
        [11, 2, 0, 4, 1, '*'],
        [12, 3, 0, 4, 2, '*'],
      ],
    )
    const { workflow: out, removedTypes } = stripFrontendOnlyNodes(w, FRONTEND_ONLY_NODE_TYPES)
    expect(removedTypes.sort()).toEqual(['Collection', 'LipSyncStudio', 'SpaceType'])
    expect((out.nodes as any[]).map(n => n.id)).toEqual([4])
    expect(out.links).toEqual([])
  })

  it('FRONTEND_ONLY_NODE_TYPES contains the known frontend-only studios and excludes real backend nodes', () => {
    for (const t of ['Collection', 'SpaceType', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'ShotDirector', 'Character', 'CharacterSheet', 'LipSyncStudio']) {
      expect(FRONTEND_ONLY_NODE_TYPES.has(t)).toBe(true)
    }
    for (const t of ['Compositor', 'SmartLayout', 'Timeline', 'Image', 'Text', 'Audio', 'Video', 'KSampler']) {
      expect(FRONTEND_ONLY_NODE_TYPES.has(t)).toBe(false)
    }
  })
})
