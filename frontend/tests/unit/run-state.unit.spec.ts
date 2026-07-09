import { describe, expect, it, beforeEach } from 'vitest'
import {
  registerRun, finishRun, getRun, clearAllRuns, perRun, dropRunState,
  type RunState,
} from '~/lib/graph/runRegistry'

beforeEach(() => {
  clearAllRuns()
})

describe('perRun (registered)', () => {
  it('returns the seeded state for a registered run', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const state = perRun('p1')
    expect(state.executedNodeIds).toBeInstanceOf(Set)
    expect(state.executedNodeIds.size).toBe(0)
    expect(state.outputs).toEqual([])
    expect(state.startCredits).toBeNull()
    expect(state.nodeProgress).toEqual({ completed: 0, total: 0 })
    expect(state.runningNode).toBeNull()
    expect(state.estimateNodes).toEqual([])
  })

  it('is a stable reference across calls — mutations persist', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const a = perRun('p1')
    a.executedNodeIds.add('node1')
    a.outputs.push({ foo: 'bar' })
    a.startCredits = 42
    const b = perRun('p1')
    expect(b).toBe(a)
    expect(b.executedNodeIds.has('node1')).toBe(true)
    expect(b.outputs).toEqual([{ foo: 'bar' }])
    expect(b.startCredits).toBe(42)
  })
})

describe('perRun (transient / unregistered)', () => {
  it('returns a transient bag for an unregistered promptId, stable across calls', () => {
    const a = perRun('unregistered-id')
    a.runningNode = 'nodeX'
    const b = perRun('unregistered-id')
    expect(b).toBe(a)
    expect(b.runningNode).toBe('nodeX')
  })

  it('returns a stable `_`-keyed transient for null', () => {
    const a = perRun(null)
    a.estimateNodes = [{ x: 1 }]
    const b = perRun(null)
    expect(b).toBe(a)
    expect(b.estimateNodes).toEqual([{ x: 1 }])
  })

  it('returns a stable `_`-keyed transient for undefined', () => {
    const a = perRun(undefined)
    a.nodeProgress.total = 5
    const b = perRun(undefined)
    expect(b).toBe(a)
    expect(b.nodeProgress.total).toBe(5)
  })

  it('null and undefined share the same `_`-keyed transient bag', () => {
    const a = perRun(null)
    const b = perRun(undefined)
    expect(b).toBe(a)
  })

  it('different unregistered ids get different transient bags', () => {
    const a = perRun('idA')
    const b = perRun('idB')
    expect(a).not.toBe(b)
  })
})

describe('finishRun drops registered RunState', () => {
  it('next perRun after finishRun is a fresh state', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const before = perRun('p1')
    before.executedNodeIds.add('node1')
    finishRun('p1', 'done')

    // p1 is no longer registered, so perRun now returns a transient bag,
    // which must be fresh (not the mutated registered state).
    const after = perRun('p1')
    expect(after).not.toBe(before)
    expect(after.executedNodeIds.size).toBe(0)
  })
})

describe('dropRunState', () => {
  it('clears a transient bag — next perRun for the same id is fresh', () => {
    const before = perRun('transientId')
    before.executedNodeIds.add('node1')
    dropRunState('transientId')
    const after = perRun('transientId')
    expect(after).not.toBe(before)
    expect(after.executedNodeIds.size).toBe(0)
  })

  it('clears a registered run state without affecting the RunEntry', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const before = perRun('p1')
    before.executedNodeIds.add('node1')
    dropRunState('p1')
    const after = perRun('p1')
    expect(after).not.toBe(before)
    expect(after.executedNodeIds.size).toBe(0)
    // RunEntry itself is untouched by dropRunState
    expect(getRun('p1')).not.toBeNull()
  })

  it('is a no-op for unknown ids (does not throw)', () => {
    expect(() => dropRunState('never-seen')).not.toThrow()
  })
})

describe('canvasId round-trips through registerRun/getRun', () => {
  it('stores and returns the provided canvasId', () => {
    const e = registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0, canvasId: 'canvas-A' })
    expect(e.canvasId).toBe('canvas-A')
    expect(getRun('p1')?.canvasId).toBe('canvas-A')
  })

  it('defaults to null when omitted (existing callers still compile)', () => {
    const e = registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    expect(e.canvasId).toBeNull()
    expect(getRun('p1')?.canvasId).toBeNull()
  })
})

// Type-only sanity check that RunState shape matches the brief.
const _typeCheck: RunState = {
  executedNodeIds: new Set<string>(),
  outputs: [],
  startCredits: null,
  nodeProgress: { completed: 0, total: 0 },
  runningNode: null,
  estimateNodes: [],
}
void _typeCheck
