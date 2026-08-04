import { describe, it, expect, vi, afterEach } from 'vitest'

// catalog.ts uses Nuxt's auto-imported `$fetch` as a bare global identifier (not
// an ES import), so a plain vitest import of it never resolves one — stub it on
// globalThis, the same mechanism Nuxt's runtime uses to make it available.
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { getEffectSync, refetchShaderFxCatalog } from '~/lib/shaderfx/catalogStore'

afterEach(() => {
  fetchMock.mockReset()
})

describe('catalog.ts <-> catalogStore.ts wiring', () => {
  it('a successful fetch is readable via getEffectSync', async () => {
    fetchMock.mockResolvedValueOnce({ version: 1, effects: [{ id: 'glow' }] })
    await fetchShaderFxCatalog(true)
    expect(getEffectSync('glow')?.id).toBe('glow')
  })

  // The documented behaviour on getEffectSync (originally in catalog.ts, now
  // catalogStore.ts): a failed refetch must leave the previous good catalog in
  // place rather than blanking a working sync reader.
  it('a failed refetch leaves the previous good catalog in place', async () => {
    fetchMock.mockResolvedValueOnce({ version: 1, effects: [{ id: 'glow' }] })
    await fetchShaderFxCatalog(true)
    expect(getEffectSync('glow')?.id).toBe('glow')

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(fetchShaderFxCatalog(true)).rejects.toThrow('offline')

    // Still there — the failed refetch never called setShaderFxCatalog.
    expect(getEffectSync('glow')?.id).toBe('glow')
  })

  it('registers itself as the store refetcher merely by being imported', async () => {
    fetchMock.mockResolvedValueOnce({ version: 1, effects: [{ id: 'sparkle' }] })
    const p = refetchShaderFxCatalog()
    expect(p).not.toBeNull()
    await p
    expect(getEffectSync('sparkle')?.id).toBe('sparkle')
  })
})
