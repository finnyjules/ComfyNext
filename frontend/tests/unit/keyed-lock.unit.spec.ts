import { describe, it, expect } from 'vitest'
import { withKeyedLock } from '~/lib/graph/keyedLock'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('withKeyedLock', () => {
  it('serializes same-key sections FIFO — second fn starts only after first settles', async () => {
    const events: string[] = []
    const gate = deferred()
    const first = withKeyedLock('w:0', async () => {
      events.push('a-start')
      await gate.promise
      events.push('a-end')
    })
    const second = withKeyedLock('w:0', async () => {
      events.push('b-start')
    })
    // Give the second section every chance to (wrongly) start early.
    await new Promise((r) => setTimeout(r, 10))
    expect(events).toEqual(['a-start'])
    gate.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['a-start', 'a-end', 'b-start'])
  })

  it('propagates the return value', async () => {
    const out = await withKeyedLock('w:0', async () => 42)
    expect(out).toBe(42)
  })

  it('a rejection reaches its caller without poisoning the chain', async () => {
    const boom = withKeyedLock('w:1', async () => { throw new Error('boom') })
    await expect(boom).rejects.toThrow('boom')
    const after = await withKeyedLock('w:1', async () => 'recovered')
    expect(after).toBe('recovered')
  })

  it('different keys run concurrently', async () => {
    const events: string[] = []
    const gate = deferred()
    const a = withKeyedLock('w:0', async () => {
      events.push('a-start')
      await gate.promise
    })
    const b = withKeyedLock('w:1', async () => {
      events.push('b-start')
    })
    await b
    expect(events).toContain('b-start')
    gate.resolve()
    await a
  })
})
