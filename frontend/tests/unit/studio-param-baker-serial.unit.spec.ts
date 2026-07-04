import { describe, it, expect } from 'vitest'
import {
  registerStudioParamBaker, unregisterStudioParamBaker, getStudioParamBaker,
} from '~/lib/studio/cascade'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('registerStudioParamBaker serialization', () => {
  it('serializes concurrent calls on the same id — no overlap', async () => {
    const id = 'a'
    const events: { enter: number; exit: number }[] = []
    registerStudioParamBaker(id, async () => {
      const enter = Date.now()
      await sleep(20)
      const exit = Date.now()
      events.push({ enter, exit })
      return null
    })

    const baker = getStudioParamBaker(id)!
    const results = await Promise.all([
      baker({ x: 1 }),
      baker({ x: 2 }),
      baker({ x: 3 }),
    ])

    expect(results).toEqual([null, null, null])
    expect(events).toHaveLength(3)
    // Each call's enter must be >= the previous call's exit — no interleaving.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].enter).toBeGreaterThanOrEqual(events[i - 1].exit)
    }

    unregisterStudioParamBaker(id)
  })

  it('a rejecting call does not block the next call on the same id', async () => {
    const id = 'b'
    let calls = 0
    registerStudioParamBaker(id, async (overrides) => {
      calls++
      await sleep(5)
      if (overrides.fail) throw new Error('boom')
      return null
    })

    const baker = getStudioParamBaker(id)!
    await expect(baker({ fail: 1 })).rejects.toThrow('boom')
    // The next call must still run (queue not wedged) and resolve normally.
    const result = await baker({ fail: 0 })
    expect(result).toBeNull()
    expect(calls).toBe(2)

    unregisterStudioParamBaker(id)
  })

  it('different ids run concurrently (no cross-id serialization)', async () => {
    const idA = 'c1', idB = 'c2'
    const events: { id: string; enter: number; exit: number }[] = []
    const makeBaker = (id: string) => async () => {
      const enter = Date.now()
      await sleep(20)
      const exit = Date.now()
      events.push({ id, enter, exit })
      return null
    }
    registerStudioParamBaker(idA, makeBaker(idA))
    registerStudioParamBaker(idB, makeBaker(idB))

    const bakerA = getStudioParamBaker(idA)!
    const bakerB = getStudioParamBaker(idB)!
    await Promise.all([bakerA({}), bakerB({})])

    expect(events).toHaveLength(2)
    const [e1, e2] = events
    // Overlap detected: the second call entered before the first one exited.
    const overlapped = e2.enter < e1.exit || e1.enter < e2.exit
    expect(overlapped).toBe(true)

    unregisterStudioParamBaker(idA)
    unregisterStudioParamBaker(idB)
  })
})
