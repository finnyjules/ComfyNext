import { describe, it, expect } from 'vitest'
import {
  type LayerGroup, type GroupableLayer,
  allGroupIds, parentOf, ancestorsOf, topGroupOf, groupDepth,
  childGroupIds, descendantGroupIds, directLayerIds, layersInGroup,
  isDescendantOrSelf, groupDisplayName,
  createGroupFromSelection, dissolveGroup, renameGroup, reparentGroup, pruneEmptyGroups,
} from '../../app/lib/compositor/layerGroups'

// Test fixture: two leaf layers in group A, one in group B; A and B nested under C.
//   C ─ A ─ [l1, l2]
//     └ B ─ [l3]
//   l4 loose
function fixture() {
  const layers: GroupableLayer[] = [
    { id: 'l1', groupId: 'A' },
    { id: 'l2', groupId: 'A' },
    { id: 'l3', groupId: 'B' },
    { id: 'l4' },
  ]
  const groups: LayerGroup[] = [
    { id: 'A', parentId: 'C' },
    { id: 'B', parentId: 'C' },
    { id: 'C', name: 'Top' },
  ]
  return { layers, groups }
}

describe('relationships', () => {
  const { layers, groups } = fixture()
  it('allGroupIds unions registry + layer refs', () => {
    expect(new Set(allGroupIds(layers, groups))).toEqual(new Set(['A', 'B', 'C']))
  })
  it('parentOf', () => {
    expect(parentOf('A', groups)).toBe('C')
    expect(parentOf('C', groups)).toBeUndefined()
  })
  it('ancestorsOf nearest → root', () => {
    expect(ancestorsOf('A', groups)).toEqual(['C'])
    expect(ancestorsOf('C', groups)).toEqual([])
  })
  it('topGroupOf', () => {
    expect(topGroupOf('A', groups)).toBe('C')
    expect(topGroupOf('C', groups)).toBe('C')
  })
  it('groupDepth', () => {
    expect(groupDepth('C', groups)).toBe(0)
    expect(groupDepth('A', groups)).toBe(1)
  })
  it('childGroupIds', () => {
    expect(new Set(childGroupIds('C', groups))).toEqual(new Set(['A', 'B']))
    expect(childGroupIds('A', groups)).toEqual([])
  })
  it('descendantGroupIds', () => {
    expect(new Set(descendantGroupIds('C', groups))).toEqual(new Set(['A', 'B']))
  })
  it('directLayerIds vs layersInGroup', () => {
    expect(directLayerIds('C', layers)).toEqual([]) // C has no direct layers
    expect(new Set(layersInGroup('C', layers, groups))).toEqual(new Set(['l1', 'l2', 'l3']))
    expect(new Set(layersInGroup('A', layers, groups))).toEqual(new Set(['l1', 'l2']))
  })
  it('isDescendantOrSelf', () => {
    expect(isDescendantOrSelf('A', 'C', groups)).toBe(true)
    expect(isDescendantOrSelf('C', 'C', groups)).toBe(true)
    expect(isDescendantOrSelf('C', 'A', groups)).toBe(false)
  })
})

describe('cycle guards', () => {
  it('ancestorsOf terminates on a cycle', () => {
    const groups: LayerGroup[] = [{ id: 'X', parentId: 'Y' }, { id: 'Y', parentId: 'X' }]
    expect(ancestorsOf('X', groups).length).toBeLessThanOrEqual(2)
  })
})

describe('names', () => {
  it('prefers registry name', () => {
    const { layers, groups } = fixture()
    expect(groupDisplayName('C', layers, groups)).toBe('Top')
  })
  it('falls back to a legacy mirrored groupName', () => {
    const layers: GroupableLayer[] = [{ id: 'l1', groupId: 'G', groupName: 'Legacy' }]
    expect(groupDisplayName('G', layers, [])).toBe('Legacy')
  })
  it('defaults to "Group"', () => {
    expect(groupDisplayName('G', [{ id: 'l1', groupId: 'G' }], [])).toBe('Group')
  })
})

describe('createGroupFromSelection', () => {
  it('groups loose layers into a new group', () => {
    const layers: GroupableLayer[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { layers: L } = createGroupFromSelection(layers, [], new Set(['a', 'b']), 'G')
    expect(L.find(l => l.id === 'a')!.groupId).toBe('G')
    expect(L.find(l => l.id === 'b')!.groupId).toBe('G')
    expect(L.find(l => l.id === 'c')!.groupId).toBeUndefined()
  })

  it('nests a fully-selected existing group under the new group (members untouched)', () => {
    // group A = [a1,a2] fully selected, plus loose layer x.
    const layers: GroupableLayer[] = [{ id: 'a1', groupId: 'A' }, { id: 'a2', groupId: 'A' }, { id: 'x' }]
    const { layers: L, groups: G } = createGroupFromSelection(layers, [{ id: 'A' }], new Set(['a1', 'a2', 'x']), 'NEW')
    // A is reparented under NEW; a1/a2 keep groupId A.
    expect(G.find(g => g.id === 'A')!.parentId).toBe('NEW')
    expect(L.find(l => l.id === 'a1')!.groupId).toBe('A')
    // x becomes a direct member of NEW.
    expect(L.find(l => l.id === 'x')!.groupId).toBe('NEW')
  })

  it('nests an implicit (registry-less) group by creating its entry', () => {
    const layers: GroupableLayer[] = [{ id: 'a1', groupId: 'A' }, { id: 'a2', groupId: 'A' }, { id: 'x' }]
    const { groups: G } = createGroupFromSelection(layers, [], new Set(['a1', 'a2', 'x']), 'NEW')
    expect(G.find(g => g.id === 'A')!.parentId).toBe('NEW')
    expect(G.find(g => g.id === 'NEW')).toBeTruthy()
  })

  it('pulls a partially-selected group member out into the new group', () => {
    const layers: GroupableLayer[] = [{ id: 'a1', groupId: 'A' }, { id: 'a2', groupId: 'A' }, { id: 'x' }]
    // Only a1 (not a2) selected → a1 gets pulled into NEW; A stays a root with a2.
    const { layers: L, groups: G } = createGroupFromSelection(layers, [{ id: 'A' }], new Set(['a1', 'x']), 'NEW')
    expect(L.find(l => l.id === 'a1')!.groupId).toBe('NEW')
    expect(L.find(l => l.id === 'a2')!.groupId).toBe('A')
    expect(G.find(g => g.id === 'A')!.parentId).toBeUndefined()
  })
})

describe('dissolveGroup', () => {
  it('promotes members to the parent group when nested', () => {
    const { layers, groups } = fixture()
    const { layers: L, groups: G } = dissolveGroup(layers, groups, 'A')
    // l1/l2 move from A up to A's parent C.
    expect(L.find(l => l.id === 'l1')!.groupId).toBe('C')
    expect(G.find(g => g.id === 'A')).toBeUndefined()
  })
  it('makes members loose when dissolving a root group', () => {
    const layers: GroupableLayer[] = [{ id: 'l1', groupId: 'G', groupName: 'x' }]
    const { layers: L, groups: Gs } = dissolveGroup(layers, [{ id: 'G' }], 'G')
    expect(L[0].groupId).toBeUndefined()
    expect(L[0].groupName).toBeUndefined() // legacy name cleared when going loose
    expect(Gs).toEqual([])
  })
  it('reparents child groups up one level', () => {
    const { layers, groups } = fixture()
    const { groups: G } = dissolveGroup(layers, groups, 'C') // dissolve the top
    // A and B lose their parent (C removed) → become roots.
    expect(G.find(g => g.id === 'A')!.parentId).toBeUndefined()
    expect(G.find(g => g.id === 'B')!.parentId).toBeUndefined()
  })
})

describe('renameGroup', () => {
  it('updates an existing entry', () => {
    expect(renameGroup([{ id: 'G', name: 'old' }], 'G', 'new').find(g => g.id === 'G')!.name).toBe('new')
  })
  it('creates an entry for an implicit group', () => {
    expect(renameGroup([], 'G', 'new')).toEqual([{ id: 'G', name: 'new' }])
  })
  it('clears the name on empty input', () => {
    expect(renameGroup([{ id: 'G', name: 'old' }], 'G', '  ').find(g => g.id === 'G')!.name).toBeUndefined()
  })
})

describe('reparentGroup', () => {
  it('sets a new parent', () => {
    expect(reparentGroup([{ id: 'A' }, { id: 'B' }], 'A', 'B').find(g => g.id === 'A')!.parentId).toBe('B')
  })
  it('refuses to create a cycle (parenting under a descendant)', () => {
    const groups: LayerGroup[] = [{ id: 'A' }, { id: 'B', parentId: 'A' }]
    // Parenting A under its child B would cycle → unchanged.
    expect(reparentGroup(groups, 'A', 'B')).toEqual(groups)
  })
  it('can detach to root with undefined', () => {
    expect(reparentGroup([{ id: 'A', parentId: 'B' }], 'A', undefined).find(g => g.id === 'A')!.parentId).toBeUndefined()
  })
})

describe('pruneEmptyGroups', () => {
  it('drops a group with no layers and no children', () => {
    expect(pruneEmptyGroups([], [{ id: 'ghost' }])).toEqual([])
  })
  it('keeps a group that still holds layers', () => {
    const groups: LayerGroup[] = [{ id: 'G' }]
    expect(pruneEmptyGroups([{ id: 'l1', groupId: 'G' }], groups)).toEqual(groups)
  })
  it('cleans a chain of emptied ancestors in one pass', () => {
    // C → A, but A/C have no layers left → both pruned.
    const groups: LayerGroup[] = [{ id: 'A', parentId: 'C' }, { id: 'C' }]
    expect(pruneEmptyGroups([], groups)).toEqual([])
  })
  it('keeps an ancestor whose descendant group holds a layer', () => {
    const groups: LayerGroup[] = [{ id: 'A', parentId: 'C' }, { id: 'C' }]
    const kept = pruneEmptyGroups([{ id: 'l1', groupId: 'A' }], groups)
    expect(new Set(kept.map(g => g.id))).toEqual(new Set(['A', 'C']))
  })
})
