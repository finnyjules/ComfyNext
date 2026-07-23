import { describe, it, expect } from 'vitest'
import { isBackfillCandidate, createTaskQueue } from '~/lib/coverBackfill'

describe('isBackfillCandidate', () => {
  it('accepts a uuid card with no images', () => {
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: [] })).toBe(true)
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: null })).toBe(true)
  })
  it('rejects cards that already have images', () => {
    expect(isBackfillCandidate({ workflowId: 'abc-123', images: [{}] })).toBe(false)
  })
  it('rejects history-fingerprint ids and missing ids', () => {
    expect(isBackfillCandidate({ workflowId: 'KSampler,VAEDecode', images: [] })).toBe(false)
    expect(isBackfillCandidate({ workflowId: '', images: [] })).toBe(false)
    expect(isBackfillCandidate({ workflowId: null, images: [] })).toBe(false)
  })
})

describe('createTaskQueue', () => {
  function deferred() {
    let resolve!: () => void, reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function macrotaskFlush() {
    return new Promise((r) => setTimeout(r, 0))
  }

  it('never runs more than maxConcurrent tasks at once and drains all', async () => {
    const queue = createTaskQueue(2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    gates.forEach((g, i) => queue.push(() => { started.push(i); return g.promise }))
    await macrotaskFlush()
    expect(started).toEqual([0, 1])          // FIFO, capped at 2
    expect(queue.activeCount).toBe(2)
    expect(queue.pendingCount).toBe(2)
    gates[0].resolve()
    await macrotaskFlush()
    expect(started).toEqual([0, 1, 2])       // slot freed → next starts
    gates[1].resolve(); gates[2].resolve(); gates[3].resolve()
    await macrotaskFlush()
    expect(started).toEqual([0, 1, 2, 3])
    expect(queue.activeCount).toBe(0)
    expect(queue.pendingCount).toBe(0)
  })

  it('keeps draining after a task rejects', async () => {
    const queue = createTaskQueue(1)
    const started: number[] = []
    const gate = deferred()
    queue.push(() => { started.push(0); return Promise.reject(new Error('boom')) })
    queue.push(() => { started.push(1); return gate.promise })
    await macrotaskFlush()
    expect(started).toEqual([0, 1])
    gate.resolve()
    await macrotaskFlush()
    expect(queue.activeCount).toBe(0)
  })

  it('also survives a task that throws synchronously', async () => {
    const queue = createTaskQueue(1)
    const started: number[] = []
    queue.push(() => { started.push(0); throw new Error('sync boom') })
    queue.push(() => { started.push(1); return Promise.resolve() })
    await macrotaskFlush()
    expect(started).toEqual([0, 1])
    expect(queue.activeCount).toBe(0)
  })
})
