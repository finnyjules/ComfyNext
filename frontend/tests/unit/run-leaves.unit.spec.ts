import { describe, it, expect } from 'vitest'
import { computeRunLeafIds } from '../../app/lib/canvas/runLeaves'

const edge = (source: string, target: string) => ({ source, target })

describe('computeRunLeafIds', () => {
  it('a linear chain has exactly one leaf: the terminal node', () => {
    // gen → mid → out, all in the run (upstream keep-set of `out`)
    const run = new Set(['gen', 'mid', 'out'])
    const edges = [edge('gen', 'mid'), edge('mid', 'out')]
    expect(computeRunLeafIds(run, edges)).toEqual(new Set(['out']))
  })

  it('an intermediate result feeding the next generator is NOT a leaf', () => {
    // BlendScene → blendResult → Relight → relightResult (the reported case:
    // the churn must land on relightResult only, never on blendResult).
    const run = new Set(['blend', 'blendResult', 'relight', 'relightResult'])
    const edges = [
      edge('blend', 'blendResult'),
      edge('blendResult', 'relight'),
      edge('relight', 'relightResult'),
    ]
    expect(computeRunLeafIds(run, edges)).toEqual(new Set(['relightResult']))
  })

  it('edges to nodes OUTSIDE the run do not cost a node its leaf status', () => {
    // `out` also feeds some other node that is not part of this run.
    const run = new Set(['gen', 'out'])
    const edges = [edge('gen', 'out'), edge('out', 'unrelated')]
    expect(computeRunLeafIds(run, edges)).toEqual(new Set(['out']))
  })

  it('a fan-out keeps every in-run terminal as a leaf', () => {
    const run = new Set(['gen', 'sinkA', 'sinkB'])
    const edges = [edge('gen', 'sinkA'), edge('gen', 'sinkB')]
    expect(computeRunLeafIds(run, edges)).toEqual(new Set(['sinkA', 'sinkB']))
  })

  it('an empty run set yields an empty leaf set', () => {
    expect(computeRunLeafIds(new Set(), [edge('a', 'b')])).toEqual(new Set())
  })

  it('coerces numeric ids to strings', () => {
    const run = new Set(['1', '2'])
    const edges = [{ source: 1, target: 2 }]
    expect(computeRunLeafIds(run, edges)).toEqual(new Set(['2']))
  })
})
