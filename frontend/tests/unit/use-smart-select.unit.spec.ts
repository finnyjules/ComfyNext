import { describe, it, expect } from 'vitest'
import { useSmartSelect } from '~/composables/useSmartSelect'

/** Manually-resolvable segment stub. */
function deferredSegment() {
  const calls: { points: { x: number; y: number; label: 0 | 1 }[]; resolve: (m: string[]) => void; reject: (e: Error) => void }[] = []
  const segment = (_image: string, points: { x: number; y: number; label: 0 | 1 }[]) =>
    new Promise<string[]>((resolve, reject) => { calls.push({ points, resolve, reject }) })
  return { calls, segment }
}
const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('useSmartSelect', () => {
  it('accumulates points and refines with ALL of them', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 2, label: 1 }])
    const p = s.refine('img')
    expect(s.busy.value).toBe(true)
    expect(calls[0]!.points).toEqual([{ x: 1, y: 2, label: 1 }])
    calls[0]!.resolve(['data:mask1'])
    await p
    expect(s.busy.value).toBe(false)
    expect(s.maskUrls.value).toEqual(['data:mask1'])
    expect(s.failed.value).toBe(false)
  })

  it('collapses refines during flight, but the queued re-run is same-image so it hits the cache (no 2nd call)', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p1 = s.refine('img')
    s.addPoints([{ x: 2, y: 2, label: 1 }])
    void s.refine('img')
    s.addPoints([{ x: 3, y: 3, label: 0 }])
    void s.refine('img')
    expect(calls.length).toBe(1)
    calls[0]!.resolve(['data:mask1'])
    await p1; await tick()
    // The queued re-run is for the SAME image — the API output doesn't depend
    // on points, so it hits the per-image cache instead of firing a 2nd call.
    expect(calls.length).toBe(1)
    expect(s.maskUrls.value).toEqual(['data:mask1'])
  })

  it('caches candidates per image: same image after success skips the call, a different image refetches', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p1 = s.refine('img-a')
    calls[0]!.resolve(['data:mask-a'])
    await p1

    await s.refine('img-a')
    expect(calls.length).toBe(1)
    expect(s.maskUrls.value).toEqual(['data:mask-a'])

    const p2 = s.refine('img-b')
    expect(calls.length).toBe(2)
    calls[1]!.resolve(['data:mask-b'])
    await p2
    expect(s.maskUrls.value).toEqual(['data:mask-b'])
  })

  it('failure sets failed and clears maskUrl (fallback-to-scribble)', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p = s.refine('img')
    calls[0]!.reject(new Error('boom'))
    await p
    expect(s.failed.value).toBe(true)
    expect(s.maskUrls.value).toBeNull()
    expect(s.busy.value).toBe(false)
  })

  it('reset drops in-flight results (stale response never lands)', async () => {
    const { calls, segment } = deferredSegment()
    const s = useSmartSelect({ segment })
    s.addPoints([{ x: 1, y: 1, label: 1 }])
    const p = s.refine('img')
    s.reset()
    calls[0]!.resolve(['data:stale'])
    await p
    expect(s.maskUrls.value).toBeNull()
    expect(s.points.value).toEqual([])
    expect(s.busy.value).toBe(false)
  })
})
