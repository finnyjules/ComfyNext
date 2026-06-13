import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackendHealth } from '~/composables/useBackendHealth'

// fetchFn that resolves (=up) or rejects (=down) per a scripted boolean list;
// the last entry repeats for any extra polls.
function makeFetch(results: boolean[]) {
  let i = 0
  return vi.fn(async () => {
    const ok = results[Math.min(i, results.length - 1)]
    i++
    if (ok) return {} as Response
    throw new Error('network')
  })
}

describe('useBackendHealth', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flips down only after 2 consecutive failures (debounce)', async () => {
    const fetchFn = makeFetch([true, false, false])
    const h = useBackendHealth('http://x', { fetchFn, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // tick 1: success → up
    expect(h.backendUp.value).toBe(true)
    await vi.advanceTimersByTimeAsync(100)   // tick 2: fail #1 → still up
    expect(h.backendUp.value).toBe(true)
    await vi.advanceTimersByTimeAsync(100)   // tick 3: fail #2 → down
    expect(h.backendUp.value).toBe(false)
    h.stop()
  })

  it('does NOT fire onRecovered on the initial down→up (first boot)', async () => {
    const onRecovered = vi.fn()
    const fetchFn = makeFetch([false, false, true])  // boots while backend down
    const h = useBackendHealth('http://x', { fetchFn, onRecovered, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // tick 1: fail #1 → still up, schedules at healthyMs=100
    await vi.advanceTimersByTimeAsync(100)   // tick 2: fail #2 → down, schedules at downMs=50
    await vi.advanceTimersByTimeAsync(50)    // tick 3: first-ever success → up, NOT recovery
    expect(h.backendUp.value).toBe(true)
    expect(onRecovered).not.toHaveBeenCalled()
    h.stop()
  })

  it('fires onRecovered once when a previously-up backend goes down then up', async () => {
    const onRecovered = vi.fn()
    const fetchFn = makeFetch([true, false, false, true])
    const h = useBackendHealth('http://x', { fetchFn, onRecovered, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // tick 1: up → everUp=true, schedules at healthyMs=100
    await vi.advanceTimersByTimeAsync(100)   // tick 2: fail #1 → still up, schedules at healthyMs=100
    await vi.advanceTimersByTimeAsync(100)   // tick 3: fail #2 → down, schedules at downMs=50
    await vi.advanceTimersByTimeAsync(50)    // tick 4: up → recovery
    expect(onRecovered).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('resets the failure counter after recovery (one later fail does not flip down)', async () => {
    // up → 2 fails (down) → up (recovered, counter reset) → 1 fail → still up
    const fetchFn = makeFetch([true, false, false, true, false])
    const h = useBackendHealth('http://x', { fetchFn, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // up
    await vi.advanceTimersByTimeAsync(100)   // fail #1
    await vi.advanceTimersByTimeAsync(100)   // fail #2 → down
    await vi.advanceTimersByTimeAsync(50)    // up (counter reset)
    await vi.advanceTimersByTimeAsync(100)   // single fail → still up (counter was reset)
    expect(h.backendUp.value).toBe(true)
    h.stop()
  })

  it('stop() halts polling', async () => {
    const fetchFn = makeFetch([true])
    const h = useBackendHealth('http://x', { fetchFn, healthyMs: 100 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)
    const calls = fetchFn.mock.calls.length
    h.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchFn.mock.calls.length).toBe(calls)
  })
})
