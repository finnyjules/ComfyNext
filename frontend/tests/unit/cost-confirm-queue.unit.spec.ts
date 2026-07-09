import { describe, it, expect } from 'vitest'
import { CostConfirmQueue, type CostConfirmRequest } from '~/lib/graph/costConfirmQueue'

// A minimal stand-in for a CostEstimate — the queue is agnostic to its shape.
const est = (usd: number) => ({ usd }) as any

describe('CostConfirmQueue', () => {
  it('resolves a single request with the answer, then goes empty', async () => {
    const q = new CostConfirmQueue()
    const p = q.enqueue(est(2), 1)
    expect(q.head?.iterations).toBe(1)
    expect(q.size).toBe(1)
    q.resolveHead(true)
    await expect(p).resolves.toBe(true)
    expect(q.head).toBeNull()
    expect(q.size).toBe(0)
  })

  it('is FIFO: two independent runs each resolve their OWN promise in order', async () => {
    const q = new CostConfirmQueue()
    const pA = q.enqueue(est(3), 1) // run A
    const pB = q.enqueue(est(5), 2) // run B, queued behind A
    expect(q.size).toBe(2)
    // Head is A. Resolving the head advances to B — A's promise (not B's) settles.
    expect(q.head?.estimate.usd).toBe(3)
    q.resolveHead(true) // A → true
    await expect(pA).resolves.toBe(true)
    // B is now the head and still pending.
    expect(q.head?.estimate.usd).toBe(5)
    expect(q.size).toBe(1)
    q.resolveHead(false) // B → false
    await expect(pB).resolves.toBe(false)
    expect(q.head).toBeNull()
  })

  it('resolveHead on an empty queue is a no-op (no throw)', () => {
    const q = new CostConfirmQueue()
    expect(() => q.resolveHead(true)).not.toThrow()
    expect(q.head).toBeNull()
  })

  it('cancelAll rejects nothing but resolves every pending request false', async () => {
    const q = new CostConfirmQueue()
    const pA = q.enqueue(est(1), 1)
    const pB = q.enqueue(est(2), 1)
    q.cancelAll()
    await expect(pA).resolves.toBe(false)
    await expect(pB).resolves.toBe(false)
    expect(q.size).toBe(0)
  })

  it('exposes the pending list reactively-friendly (array snapshot for template head)', () => {
    const q = new CostConfirmQueue()
    q.enqueue(est(1), 1)
    q.enqueue(est(2), 3)
    const items = q.pending as CostConfirmRequest<any>[]
    expect(items.map((r) => r.iterations)).toEqual([1, 3])
  })
})
