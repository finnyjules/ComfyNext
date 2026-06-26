import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadSpaceDefaults, spaceDefaultFor, saveSpaceDefault, __resetSpaceDefaultsCache } from '~/composables/useSpaceDefaults'

beforeEach(() => { __resetSpaceDefaultsCache(); vi.restoreAllMocks() })

describe('useSpaceDefaults', () => {
  it('fetches the map once and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ribbon: { params: { text: 'R' } } }) })
    vi.stubGlobal('fetch', fetchMock)
    await loadSpaceDefaults(); await loadSpaceDefaults()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(spaceDefaultFor('ribbon')?.params.text).toBe('R')
    expect(spaceDefaultFor('field')).toBeNull()
  })
  it('resolves to {} on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect(await loadSpaceDefaults()).toEqual({})
  })
  it('saveSpaceDefault posts and updates the cache', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })       // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // save
    vi.stubGlobal('fetch', fetchMock)
    await loadSpaceDefaults()
    const ok = await saveSpaceDefault('coil', { params: { text: 'C' } })
    expect(ok).toBe(true)
    expect(spaceDefaultFor('coil')?.params.text).toBe('C')
  })
})
