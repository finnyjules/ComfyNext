import { describe, expect, it, beforeEach } from 'vitest'
import {
  registerRun, markRunning, finishRun, getRun, inFlight, clearAllRuns, inFlightCount,
  type RunEntry,
} from '~/lib/graph/runRegistry'

beforeEach(() => {
  clearAllRuns()
})

describe('registerRun / getRun roundtrip', () => {
  it('registers a run and retrieves it by promptId', () => {
    const e = registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    expect(e).toMatchObject({ promptId: 'p1', tabId: 't1', live: true, worker: 0, status: 'queued' })
    expect(typeof e.startedAt).toBe('number')
    expect(getRun('p1')).toEqual(e)
  })

  it('accepts an optional label', () => {
    const e = registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0, label: 'my run' })
    expect(e.label).toBe('my run')
  })

  it('unknown promptId returns null', () => {
    expect(getRun('nope')).toBeNull()
  })
})

describe('markRunning', () => {
  it('transitions a queued entry to running', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const updated = markRunning('p1')
    expect(updated?.status).toBe('running')
    expect(getRun('p1')?.status).toBe('running')
  })

  it('unknown promptId returns null and does not throw', () => {
    expect(markRunning('nope')).toBeNull()
  })
})

describe('finishRun', () => {
  it('removes the entry and returns it with the given status', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const finished = finishRun('p1', 'done')
    expect(finished?.status).toBe('done')
    expect(finished?.promptId).toBe('p1')
    expect(getRun('p1')).toBeNull()
  })

  it('supports error status', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    const finished = finishRun('p1', 'error')
    expect(finished?.status).toBe('error')
    expect(getRun('p1')).toBeNull()
  })

  it('unknown promptId returns null', () => {
    expect(finishRun('nope', 'done')).toBeNull()
  })
})

describe('inFlight', () => {
  beforeEach(() => {
    registerRun({ promptId: 'p1', tabId: 'tabA', live: true, worker: 0 })
    registerRun({ promptId: 'p2', tabId: 'tabA', live: true, worker: 1 })
    registerRun({ promptId: 'p3', tabId: 'tabB', live: true, worker: 0 })
  })

  it('returns all entries with no filter', () => {
    expect(inFlight().map((e) => e.promptId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('filters by tabId', () => {
    expect(inFlight({ tabId: 'tabA' }).map((e) => e.promptId).sort()).toEqual(['p1', 'p2'])
    expect(inFlight({ tabId: 'tabB' }).map((e) => e.promptId)).toEqual(['p3'])
  })

  it('filters by worker', () => {
    expect(inFlight({ worker: 0 }).map((e) => e.promptId).sort()).toEqual(['p1', 'p3'])
    expect(inFlight({ worker: 1 }).map((e) => e.promptId)).toEqual(['p2'])
  })

  it('filters by both tabId and worker', () => {
    expect(inFlight({ tabId: 'tabA', worker: 0 }).map((e) => e.promptId)).toEqual(['p1'])
  })
})

describe('inFlightCount', () => {
  it('tracks registry size across register/finish mutations', () => {
    expect(inFlightCount.value).toBe(0)
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    expect(inFlightCount.value).toBe(1)
    registerRun({ promptId: 'p2', tabId: 't1', live: true, worker: 0 })
    expect(inFlightCount.value).toBe(2)
    finishRun('p1', 'done')
    expect(inFlightCount.value).toBe(1)
    finishRun('p2', 'error')
    expect(inFlightCount.value).toBe(0)
  })

  it('does not change on markRunning (no size change)', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    expect(inFlightCount.value).toBe(1)
    markRunning('p1')
    expect(inFlightCount.value).toBe(1)
  })
})

describe('clearAllRuns', () => {
  it('resets the registry and inFlightCount', () => {
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 })
    registerRun({ promptId: 'p2', tabId: 't1', live: true, worker: 0 })
    clearAllRuns()
    expect(getRun('p1')).toBeNull()
    expect(getRun('p2')).toBeNull()
    expect(inFlight()).toEqual([])
    expect(inFlightCount.value).toBe(0)
  })
})

// Type-only sanity check that RunEntry shape matches the brief.
const _typeCheck: RunEntry = {
  promptId: 'x', tabId: 'y', live: true, worker: 0, startedAt: 0, status: 'queued',
}
void _typeCheck
