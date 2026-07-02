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

  it('resolveVariantRefs picks the named variant and falls back to default for unknown ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ characters: [REVA] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { useCharacters } = await import('~/composables/useCharacters')
    const { refresh, resolveVariantRefs } = useCharacters()
    await refresh()

    expect(resolveVariantRefs([{ slug: 'reva', variantId: 'punk' }])).toEqual({
      reva: ['/view?filename=p1.png&type=input'],
    })
    // Unknown variant id falls back to the default variant.
    expect(resolveVariantRefs([{ slug: 'reva', variantId: 'nonexistent' }])).toEqual({
      reva: ['/view?filename=r1.png&type=input', '/view?filename=r2.png&type=input'],
    })
    // No variantId → default variant.
    expect(resolveVariantRefs([{ slug: 'reva' }])).toEqual({
      reva: ['/view?filename=r1.png&type=input', '/view?filename=r2.png&type=input'],
    })
    // Unknown slug → empty array.
    expect(resolveVariantRefs([{ slug: 'ghost' }])).toEqual({ ghost: [] })
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
