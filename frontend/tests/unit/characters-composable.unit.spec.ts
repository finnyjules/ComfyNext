import { afterEach, describe, expect, it, vi } from 'vitest'

const REVA = { name: 'Reva', slug: 'reva', refImages: ['r1.png', 'r2.png'], coverIndex: 1, loraName: null, trigger: null, notes: '' }

describe('useCharacters', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('fetches once, resolves refs to /view URLs, and computes coverUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh, resolveRefs, coverUrl } = useCharacters()
    await refresh()
    expect(characters.value).toHaveLength(1)
    expect(resolveRefs(['reva', 'ghost'])).toEqual({
      reva: ['/view?filename=r1.png&type=input', '/view?filename=r2.png&type=input'],
      ghost: [],
    })
    expect(coverUrl(characters.value[0]!)).toBe('/view?filename=r2.png&type=input')
  })

  it('survives a failed fetch (offline) with an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh } = useCharacters()
    await refresh()
    expect(characters.value).toEqual([])
  })
})
