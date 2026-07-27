import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Final review, Item 4 (Important): the catalog retry used to be a request storm —
// every `resolveField`/`beginFieldFrame` MISS re-armed `_catalogRetry` immediately in
// its `.finally`, so a live host rendering against a down backend called `$fetch` once
// per animation frame, indefinitely. And even once the catalog loaded successfully, a
// miss caused by "this effect id just isn't in it" (a renamed effect) kept re-fetching
// the SAME already-resolved promise and re-firing every `onFieldCatalogReady`
// subscriber once per miss instead of once per load. Both fixed with bounded
// backoff + a give-up gate + a `_catalogLoaded` flag, with `retryFieldCatalog()` as the
// explicit escape hatch. Mocks `~/lib/shaderfx/catalog` directly so this test controls
// fetch resolution/rejection without touching Nuxt's `$fetch` or real network I/O.

const fetchMock = vi.fn()
const getEffectSyncMock = vi.fn(() => null)

vi.mock('~/lib/shaderfx/catalog', () => ({
  fetchShaderFxCatalog: (...args: unknown[]) => fetchMock(...args),
  getEffectSync: (...args: unknown[]) => getEffectSyncMock(...args),
}))

import { resolveField, clearFieldCache, retryFieldCatalog, onFieldCatalogReady } from '~/lib/shaderfill/field'
import { DEFAULT_SHADER_SPEC } from '~/lib/spacetype/fillTile'

const req = (id: string) => ({ spec: { ...DEFAULT_SHADER_SPEC, effectId: id, params: {} }, w: 64, h: 64, t: 0, fps: 30 })

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  getEffectSyncMock.mockReset()
  getEffectSyncMock.mockReturnValue(null)   // every request is a "miss" — isolates retry policy
  clearFieldCache()
  // clearFieldCache() deliberately does NOT reset catalog-retry state (see its own doc in
  // field.ts) — reset it explicitly so each test starts from a clean retry budget.
  retryFieldCatalog()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('kickCatalogFetch — dedupe while in flight', () => {
  it('several misses in the same tick collapse to exactly one fetch', async () => {
    // Rejects (rather than never resolving) so `_catalogRetry` is fully settled by the
    // end of this test — a dangling never-settled promise would otherwise leak into
    // later tests in this file, since only settlement clears it (see kickCatalogFetch's
    // `.finally`).
    fetchMock.mockRejectedValue(new Error('offline'))
    resolveField(req('a'))
    resolveField(req('a'))
    resolveField(req('b'))
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('kickCatalogFetch — bounded retries with backoff (no storm)', () => {
  it('a backend that stays down gets a BOUNDED number of attempts, not one per miss', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    for (let i = 0; i < 15; i++) {
      resolveField(req('a'))
      // eslint-disable-next-line no-await-in-loop
      await vi.runAllTimersAsync()   // flush this attempt's backoff delay + rejection fully
    }
    const totalAttempts = fetchMock.mock.calls.length
    expect(totalAttempts).toBeGreaterThan(0)
    expect(totalAttempts).toBeLessThan(15)   // strictly bounded — NOT one call per miss

    // Further misses after giving up must not place any more calls.
    resolveField(req('a'))
    await vi.runAllTimersAsync()
    expect(fetchMock.mock.calls.length).toBe(totalAttempts)
  })

  it('retryFieldCatalog() re-arms fetching after a give-up', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    for (let i = 0; i < 15; i++) {
      resolveField(req('a'))
      // eslint-disable-next-line no-await-in-loop
      await vi.runAllTimersAsync()
    }
    const callsAtGiveUp = fetchMock.mock.calls.length

    retryFieldCatalog()
    resolveField(req('a'))
    await vi.runAllTimersAsync()
    expect(fetchMock.mock.calls.length).toBe(callsAtGiveUp + 1)
  })
})

describe('kickCatalogFetch — once loaded, a miss on a MISSING effect id never re-fetches or re-notifies', () => {
  it('fires onFieldCatalogReady exactly once per successful load, not once per subsequent miss', async () => {
    fetchMock.mockResolvedValue({ effects: [] })   // "loads" successfully, but never contains our effect id
    const cb = vi.fn()
    const unsub = onFieldCatalogReady(cb)

    resolveField(req('a')) // kicks the fetch
    await vi.runAllTimersAsync()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // getEffectSync stays mocked to null — every further call is STILL a miss (the
    // effect genuinely isn't in the loaded catalog), which used to re-fetch the same
    // resolved promise and re-notify every subscriber, once per miss, forever.
    resolveField(req('a'))
    resolveField(req('a'))
    resolveField(req('a'))
    await vi.runAllTimersAsync()

    expect(cb).toHaveBeenCalledTimes(1)      // NOT once per miss
    expect(fetchMock).toHaveBeenCalledTimes(1) // NOT one fetch per miss

    unsub()
  })

  it('retryFieldCatalog() allows a fresh fetch + a fresh notification after a load', async () => {
    fetchMock.mockResolvedValue({ effects: [] })
    const cb = vi.fn()
    const unsub = onFieldCatalogReady(cb)

    resolveField(req('a'))
    await vi.runAllTimersAsync()
    expect(cb).toHaveBeenCalledTimes(1)

    retryFieldCatalog()
    resolveField(req('a'))
    await vi.runAllTimersAsync()
    expect(cb).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    unsub()
  })
})
