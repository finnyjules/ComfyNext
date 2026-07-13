import { afterEach, describe, expect, it, vi } from 'vitest'

const LORA = {
  filename: 'Pop_Clay.safetensors',
  name: 'Pop_Clay',
  baseModel: 'flux-dev',
  provider: 'replicate',
  trigger: 'pop_clay',
  aesthetic: 'claymation pop',
  kind: 'style',
  url: null,
  coverUrl: '/covers/pop_clay.webp',
  trainedOn: null,
  sizeBytes: 123,
}

describe('useLocalLoras', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('tracks loading during refresh and populates loras on success', async () => {
    let release!: (v: unknown) => void
    const gate = new Promise((r) => { release = r })
    const fetchMock = vi.fn().mockImplementation(async () => {
      await gate
      return { ok: true, json: async () => ({ loras: [LORA] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { useLocalLoras } = await import('~/composables/useLocalLoras')
    const { loras, loading, error, refresh } = useLocalLoras()

    const pending = refresh()
    expect(loading.value).toBe(true)
    release(null)
    await pending
    expect(loading.value).toBe(false)
    expect(error.value).toBe('')
    expect(loras.value).toHaveLength(1)
    expect(loras.value[0]?.name).toBe('Pop_Clay')
  })

  it('surfaces an HTTP error status instead of silently showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    const { useLocalLoras } = await import('~/composables/useLocalLoras')
    const { loading, error, refresh } = useLocalLoras()
    await refresh()
    expect(loading.value).toBe(false)
    expect(error.value).toContain('500')
  })

  it('surfaces network failures and keeps the last known list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ loras: [LORA] }) })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const { useLocalLoras } = await import('~/composables/useLocalLoras')
    const { loras, error, refresh } = useLocalLoras()
    await refresh()
    expect(loras.value).toHaveLength(1)
    await refresh()
    expect(error.value).toBeTruthy()
    // Offline tolerance: the previously fetched list survives the failure.
    expect(loras.value).toHaveLength(1)
  })

  it('clears the error when a retry succeeds', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ loras: [LORA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useLocalLoras } = await import('~/composables/useLocalLoras')
    const { loras, error, refresh } = useLocalLoras()
    await refresh()
    expect(error.value).toBeTruthy()
    await refresh()
    expect(error.value).toBe('')
    expect(loras.value).toHaveLength(1)
  })
})
