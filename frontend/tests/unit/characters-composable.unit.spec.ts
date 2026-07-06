import { afterEach, describe, expect, it, vi } from 'vitest'

const REVA = {
  name: 'Reva',
  slug: 'reva',
  variants: [
    { id: 'default', label: 'Default', descriptor: '', refImages: ['r1.png', 'r2.png'], coverIndex: 1 },
    { id: 'punk', label: 'Punk', descriptor: 'shaved head, leather jacket', refImages: ['p1.png'], coverIndex: 0 },
  ],
  loraName: null,
  trigger: null,
  notes: '',
}

describe('useCharacters', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('fetches once, resolves refs to /view URLs, and computes coverUrl from the default variant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh, resolveRefs, coverUrl } = useCharacters()
    await refresh()
    expect(characters.value).toHaveLength(1)
    // Cover-first: coverIndex 1 (r2) leads the resolved list.
    expect(resolveRefs(['reva', 'ghost'])).toEqual({
      reva: ['/view?filename=r2.png&type=input', '/view?filename=r1.png&type=input'],
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

  it('resolveVariantRefs picks the named variant and falls back to default for unknown ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { refresh, resolveVariantRefs } = useCharacters()
    await refresh()

    expect(resolveVariantRefs([{ slug: 'reva', variantId: 'punk' }])).toEqual({
      reva: ['/view?filename=p1.png&type=input'],
    })
    // Unknown variant id falls back to the default variant (cover-first: r2 leads).
    expect(resolveVariantRefs([{ slug: 'reva', variantId: 'nonexistent' }])).toEqual({
      reva: ['/view?filename=r2.png&type=input', '/view?filename=r1.png&type=input'],
    })
    // No variantId → default variant (cover-first).
    expect(resolveVariantRefs([{ slug: 'reva' }])).toEqual({
      reva: ['/view?filename=r2.png&type=input', '/view?filename=r1.png&type=input'],
    })
    // Unknown slug → empty array.
    expect(resolveVariantRefs([{ slug: 'ghost' }])).toEqual({ ghost: [] })
  })

  it('coverFirstRefs orders the cover first and tolerates edge coverIndexes', async () => {
    const { coverFirstRefs } = await import('~/composables/useCharacters')
    expect(coverFirstRefs({ refImages: ['a', 'b', 'c'], coverIndex: 2 })).toEqual(['c', 'a', 'b'])
    expect(coverFirstRefs({ refImages: ['a', 'b'], coverIndex: 0 })).toEqual(['a', 'b'])
    expect(coverFirstRefs({ refImages: ['solo'], coverIndex: 5 })).toEqual(['solo']) // clamped, single
    expect(coverFirstRefs({ refImages: [], coverIndex: 0 })).toEqual([])
    expect(coverFirstRefs(undefined)).toEqual([])
    expect(coverFirstRefs({ refImages: ['a', 'b', 'c'], coverIndex: 9 })).toEqual(['c', 'a', 'b']) // clamped high
  })

  it('coverUrl(c, variantId) returns the named variant cover, falling back to default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { characters, refresh, coverUrl } = useCharacters()
    await refresh()
    const c = characters.value[0]!
    expect(coverUrl(c, 'punk')).toBe('/view?filename=p1.png&type=input')
    expect(coverUrl(c, 'nonexistent')).toBe('/view?filename=r2.png&type=input')
    expect(coverUrl(c)).toBe('/view?filename=r2.png&type=input')
  })

  it('characterStatus derives draft/training/ready from lora link + job queue', async () => {
    const { characterStatus } = await import('~/composables/useCharacters')
    const ready = { ...REVA, loraName: 'reva-lora' }
    expect(characterStatus(ready, [])).toBe('ready')

    const draft = { ...REVA, loraName: null }
    expect(characterStatus(draft, [])).toBe('draft')

    const trainingByDisplayName = { ...REVA, loraName: null }
    expect(characterStatus(trainingByDisplayName, [
      { status: 'processing', loraKind: 'character', displayName: 'Reva', outputName: 'unrelated' },
    ])).toBe('training')

    const trainingByOutputName = { ...REVA, loraName: null }
    expect(characterStatus(trainingByOutputName, [
      { status: 'queued', loraKind: 'character', displayName: 'Something Else', outputName: 'REVA' },
    ])).toBe('training')

    // Wrong loraKind doesn't count.
    const notCharacterKind = { ...REVA, loraName: null }
    expect(characterStatus(notCharacterKind, [
      { status: 'processing', loraKind: 'style', displayName: 'Reva', outputName: 'reva' },
    ])).toBe('draft')

    // Terminal status doesn't count as training.
    const terminal = { ...REVA, loraName: null }
    expect(characterStatus(terminal, [
      { status: 'succeeded', loraKind: 'character', displayName: 'Reva', outputName: 'reva' },
    ])).toBe('draft')

    // loraName set takes priority over any in-flight job.
    const readyDespiteJob = { ...REVA, loraName: 'reva-lora' }
    expect(characterStatus(readyDespiteJob, [
      { status: 'starting', loraKind: 'character', displayName: 'Reva', outputName: 'reva' },
    ])).toBe('ready')
  })
})

describe('useTrainingJobs', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('refreshJobs populates jobs from /api/training-queue', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          { id: '1', kind: 'lora', status: 'processing', loraKind: 'character', displayName: 'Vera', outputName: 'vera', progressPct: 40 },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { useTrainingJobs } = await import('~/composables/useCharacters')
    const { jobs, refreshJobs } = useTrainingJobs()
    await refreshJobs()
    expect(jobs.value).toHaveLength(1)
    expect(jobs.value[0]?.displayName).toBe('Vera')
  })

  it('refreshJobs is offline-safe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { useTrainingJobs } = await import('~/composables/useCharacters')
    const { jobs, refreshJobs } = useTrainingJobs()
    await expect(refreshJobs()).resolves.toBeUndefined()
    expect(jobs.value).toEqual([])
  })
})

describe('missingVariantIssues', () => {
  const catalog = [
    { slug: 'vera', variants: [{ id: 'default' }, { id: 'v-abc' }] },
  ]

  it('warns when a picked variant no longer exists on a known character', async () => {
    const { missingVariantIssues } = await import('~/composables/useCharacters')
    const issues = missingVariantIssues([{ slug: 'vera', name: 'Vera', variantId: 'v-deleted' }], catalog)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warning', code: 'cast-variant-missing' })
    expect(issues[0]!.message).toContain('Vera')
  })

  it('stays silent for existing variants, default picks, and unknown characters', async () => {
    const { missingVariantIssues } = await import('~/composables/useCharacters')
    expect(missingVariantIssues([{ slug: 'vera', name: 'Vera', variantId: 'v-abc' }], catalog)).toEqual([])
    expect(missingVariantIssues([{ slug: 'vera', name: 'Vera' }], catalog)).toEqual([])
    // unknown slug: zero-refs error covers it downstream — no duplicate warning
    expect(missingVariantIssues([{ slug: 'ghost', name: 'Ghost', variantId: 'v-x' }], catalog)).toEqual([])
  })
})
