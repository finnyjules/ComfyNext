/**
 * useMoodboards (app/composables/useMoodboards.ts) — the moodboard library
 * composable, mirroring useBrandLibrary's optimistic-write contract: save()
 * upserts in memory before the PUT resolves and rolls back to server truth
 * (via refresh) on failure; remove() drops optimistically. Mirrors
 * brand-library-optimistic.unit.spec.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useMoodboards, slugifyMoodboardName } from '../../app/composables/useMoodboards'
import type { MoodboardEntry } from '../../shared/taste/moodboard'

afterEach(() => { vi.unstubAllGlobals() })

function entry(id: string, name: string, summary = 'a reading'): MoodboardEntry {
  return {
    id, name, createdAt: '', updatedAt: '', folder: 'moodboard_1786000000000',
    reading: { summary, palette: [], avoids: [] },
  }
}

describe('useMoodboards optimistic writes', () => {
  beforeEach(() => {
    const lib = useMoodboards()
    lib.moodboards.value = []
  })

  it('save() upserts into moodboards before the PUT resolves', async () => {
    let resolvePut: (v: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Promise<Response>(r => { resolvePut = r })
      return Promise.resolve(new Response(JSON.stringify({ moodboards: [] }), { status: 200 }))
    }))
    const lib = useMoodboards()
    const p = lib.save(entry('m1', 'Pastel Miami', 'sun-bleached pastel'))
    // optimistic: visible immediately, before the PUT resolves
    expect(lib.moodboards.value.find(m => m.id === 'm1')?.reading.summary).toBe('sun-bleached pastel')
    resolvePut!(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await p
  })

  it('save() rolls back to server truth on a failed PUT', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(new Response('nope', { status: 500 }))
      return Promise.resolve(new Response(JSON.stringify({ moodboards: [] }), { status: 200 }))
    }))
    const lib = useMoodboards()
    await expect(lib.save(entry('m2', 'B'))).rejects.toThrow()
    expect(lib.moodboards.value.find(m => m.id === 'm2')).toBeUndefined()
  })

  it('save() rolls back to server truth when the PUT fetch rejects (network-level failure, not !res.ok)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.reject(new Error('network down'))
      return Promise.resolve(new Response(JSON.stringify({ moodboards: [] }), { status: 200 }))
    }))
    const lib = useMoodboards()
    await expect(lib.save(entry('m4', 'D'))).rejects.toThrow()
    expect(lib.moodboards.value.find(m => m.id === 'm4')).toBeUndefined()
  })

  it('remove() drops the entry before the DELETE resolves', async () => {
    let resolveDel: (v: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Promise<Response>(r => { resolveDel = r })
      if (init?.method === 'PUT') return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({ moodboards: [] }), { status: 200 }))
    }))
    const lib = useMoodboards()
    await lib.save(entry('m3', 'C'))
    const p = lib.remove('m3')
    expect(lib.moodboards.value.find(m => m.id === 'm3')).toBeUndefined()
    resolveDel!(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await p
  })

  it('byId resolves a library entry, undefined otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({ moodboards: [] }), { status: 200 }))
    }))
    const lib = useMoodboards()
    await lib.save(entry('m5', 'E'))
    // refresh() after save wiped the list to server truth ([]) — re-seed for the lookup
    lib.moodboards.value = [entry('m5', 'E')]
    expect(lib.byId('m5')?.name).toBe('E')
    expect(lib.byId('nope')).toBeUndefined()
  })
})

describe('slugifyMoodboardName', () => {
  it('lowercases, hyphenates, strips edges, and never returns empty', () => {
    expect(slugifyMoodboardName('Pastel Miami')).toBe('pastel-miami')
    expect(slugifyMoodboardName('  --Éclair!!  ')).toBe('clair')
    expect(slugifyMoodboardName('___')).toBe('moodboard')
  })
})
