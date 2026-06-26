import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadEffectThumbnails, effectThumbUrl, saveEffectThumbnail, __resetEffectThumbnailsCache } from '~/composables/useEffectThumbnails'

beforeEach(() => { __resetEffectThumbnailsCache(); vi.restoreAllMocks() })

describe('useEffectThumbnails', () => {
  it('fetches the map once and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ribbon: '/comfynext/space_thumbnail/ribbon?v=1' }) })
    vi.stubGlobal('fetch', fetchMock)
    await loadEffectThumbnails(); await loadEffectThumbnails()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(effectThumbUrl('ribbon')).toContain('/comfynext/space_thumbnail/ribbon')
    expect(effectThumbUrl('field')).toBeNull()
  })
  it('resolves {} on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
    expect(await loadEffectThumbnails()).toEqual({})
  })
  it('saveEffectThumbnail posts and updates the cache', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })       // load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // save
    vi.stubGlobal('fetch', fetchMock)
    await loadEffectThumbnails()
    const ok = await saveEffectThumbnail('coil', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    expect(ok).toBe(true)
    expect(effectThumbUrl('coil')).toContain('/comfynext/space_thumbnail/coil')
  })
  it('re-awaiting loadEffectThumbnails after a save returns the updated map (gallery refresh)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })           // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // save
    vi.stubGlobal('fetch', fetchMock)
    await loadEffectThumbnails()
    await saveEffectThumbnail('ribbon', new Blob([new Uint8Array([1])], { type: 'image/png' }))
    const map = await loadEffectThumbnails()
    expect(map['ribbon']).toContain('/comfynext/space_thumbnail/ribbon')
  })
})
