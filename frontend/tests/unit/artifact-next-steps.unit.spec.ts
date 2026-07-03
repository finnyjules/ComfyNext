import { describe, it, expect } from 'vitest'
import { ACTION_HINTS, ARTIFACT_ACTION_IDS, upstreamSeedScope } from '~/lib/artifact/nextSteps'
import { useNextStepsStrip } from '~/composables/useNextStepsStrip'

describe('ACTION_HINTS', () => {
  it('covers every action id (null = deliberately no hint)', () => {
    for (const id of ARTIFACT_ACTION_IDS) {
      expect(ACTION_HINTS[id], `missing hint entry for ${id}`).not.toBeUndefined()
    }
  })
})

// Minimal graph shapes matching VueNodeCanvas nodes/edges arrays.
const img = (id: string, hasResult: boolean) => ({
  id,
  data: { nodeType: 'Image', images: hasResult ? ['/view?filename=x.png&type=output'] : [] },
})
const gen = (id: string) => ({ id, data: { nodeType: 'GenerateImageNode' } })
const edge = (source: string, target: string) => ({ source, target })

describe('upstreamSeedScope', () => {
  it('includes the target and its upstream producer', () => {
    // gen1 → artifact1 (target)
    const scope = upstreamSeedScope(['a1'], [gen('g1'), img('a1', true)], [edge('g1', 'a1')])
    expect(scope).toEqual(new Set(['a1', 'g1']))
  })

  it('stops at upstream artifacts that already hold a result', () => {
    // gen1 → artifact1(result) → gen2 → artifact2 (target):
    // artifact1 will be frozen by the run, so gen1 must NOT be rerolled.
    const nodes = [gen('g1'), img('a1', true), gen('g2'), img('a2', true)]
    const edges = [edge('g1', 'a1'), edge('a1', 'g2'), edge('g2', 'a2')]
    expect(upstreamSeedScope(['a2'], nodes, edges)).toEqual(new Set(['a2', 'g2']))
  })

  it('walks THROUGH artifacts without a result', () => {
    // gen1 → artifact1(empty) → gen2 → artifact2: nothing to freeze, so gen1 rerolls too.
    const nodes = [gen('g1'), img('a1', false), gen('g2'), img('a2', true)]
    const edges = [edge('g1', 'a1'), edge('a1', 'g2'), edge('g2', 'a2')]
    expect(upstreamSeedScope(['a2'], nodes, edges)).toEqual(new Set(['a2', 'g2', 'a1', 'g1']))
  })

  it('handles diamond graphs without infinite loops', () => {
    const nodes = [gen('g1'), gen('g2'), gen('g3'), img('a1', true)]
    const edges = [edge('g1', 'g2'), edge('g1', 'g3'), edge('g2', 'a1'), edge('g3', 'a1'), edge('a1', 'g1')]
    const scope = upstreamSeedScope(['a1'], nodes, edges)
    expect(scope.has('a1')).toBe(true)
    expect(scope.has('g2')).toBe(true)
    expect(scope.has('g3')).toBe(true)
  })
})

describe('useNextStepsStrip', () => {
  it('is a singleton: a fresh take on B replaces the strip on A', () => {
    const a = useNextStepsStrip()
    const b = useNextStepsStrip()
    a.announceFreshTake('node-A')
    expect(a.active.value?.nodeId).toBe('node-A')
    b.announceFreshTake('node-B')
    expect(a.active.value?.nodeId).toBe('node-B') // same shared state
  })

  it('dismiss clears the strip', () => {
    const s = useNextStepsStrip()
    s.announceFreshTake('node-A')
    s.dismiss()
    expect(s.active.value).toBeNull()
  })
})
