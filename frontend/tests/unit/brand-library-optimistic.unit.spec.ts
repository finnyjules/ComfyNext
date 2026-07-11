import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useBrandLibrary } from '../../app/composables/useBrandLibrary'

afterEach(() => { vi.unstubAllGlobals() })

describe('useBrandLibrary optimistic writes', () => {
  beforeEach(() => {
    const lib = useBrandLibrary()
    lib.kits.value = []
  })

  it('save() upserts into kits before the PUT resolves', async () => {
    let resolvePut: (v: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Promise<Response>(r => { resolvePut = r })
      return Promise.resolve(new Response(JSON.stringify({ kits: [] }), { status: 200 }))
    }))
    const lib = useBrandLibrary()
    const entry = { id: 'k1', name: 'A', kit: { palette: [{ id: 'e1', name: 'Viridian', hex: '#2A8C6E' }] }, updatedAt: '' }
    const p = lib.save(entry)
    // optimistic: visible immediately, before the PUT resolves
    expect(lib.kits.value.find(k => k.id === 'k1')?.kit.palette?.[0]?.name).toBe('Viridian')
    resolvePut!(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await p
  })

  it('save() rolls back to server truth on a failed PUT', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(new Response('nope', { status: 500 }))
      return Promise.resolve(new Response(JSON.stringify({ kits: [] }), { status: 200 }))
    }))
    const lib = useBrandLibrary()
    await expect(lib.save({ id: 'k2', name: 'B', kit: {}, updatedAt: '' })).rejects.toThrow()
    expect(lib.kits.value.find(k => k.id === 'k2')).toBeUndefined()
  })

  it('save() rolls back to server truth when the PUT fetch rejects (network-level failure, not !res.ok)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.reject(new Error('network down'))
      return Promise.resolve(new Response(JSON.stringify({ kits: [] }), { status: 200 }))
    }))
    const lib = useBrandLibrary()
    await expect(lib.save({ id: 'k4', name: 'D', kit: {}, updatedAt: '' })).rejects.toThrow()
    expect(lib.kits.value.find(k => k.id === 'k4')).toBeUndefined()
  })

  it('remove() drops the entry before the DELETE resolves', async () => {
    let resolveDel: (v: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Promise<Response>(r => { resolveDel = r })
      if (init?.method === 'PUT') return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({ kits: [] }), { status: 200 }))
    }))
    const lib = useBrandLibrary()
    await lib.save({ id: 'k3', name: 'C', kit: {}, updatedAt: '' })
    const p = lib.remove('k3')
    expect(lib.kits.value.find(k => k.id === 'k3')).toBeUndefined()
    resolveDel!(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await p
  })
})
