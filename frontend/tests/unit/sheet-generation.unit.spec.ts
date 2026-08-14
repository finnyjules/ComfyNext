import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDerivedPrompt, buildPortraitPrompt, useSheetGeneration, type SheetSource } from '~/composables/useSheetGeneration'
import { HIGGSFIELD_PANELS } from '~/data/character-shot-scenes'

const portraitSpec = HIGGSFIELD_PANELS.find((p) => p.slot === 'portrait')!
const bodyFrontSpec = HIGGSFIELD_PANELS.find((p) => p.slot === 'body-front')!

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildPortraitPrompt', () => {
  it('joins trigger + descriptor + panel prompt, comma-separated', () => {
    expect(buildPortraitPrompt(portraitSpec, { trigger: 'ohwx woman', descriptor: 'shaved head, leather jacket' }))
      .toBe(`ohwx woman, shaved head, leather jacket, ${portraitSpec.prompt}`)
  })

  it('descriptor only (no trigger) — photo mode with a variant descriptor', () => {
    expect(buildPortraitPrompt(portraitSpec, { descriptor: 'red dress' }))
      .toBe(`red dress, ${portraitSpec.prompt}`)
  })

  it('trigger only (no descriptor) — LoRA mode, default variant', () => {
    expect(buildPortraitPrompt(portraitSpec, { trigger: 'ohwx woman' }))
      .toBe(`ohwx woman, ${portraitSpec.prompt}`)
  })

  it('panel prompt only — no trigger, no descriptor', () => {
    expect(buildPortraitPrompt(portraitSpec, {})).toBe(portraitSpec.prompt)
  })

  it('ignores a null trigger (loraGen source shape uses trigger: string | null)', () => {
    expect(buildPortraitPrompt(portraitSpec, { trigger: null, descriptor: undefined })).toBe(portraitSpec.prompt)
  })

  it('wardrobe descriptor + body phrase — both comma-joined ahead of the panel prompt', () => {
    expect(buildPortraitPrompt(portraitSpec, { trigger: 'ohwx woman', descriptor: 'shaved head, leather jacket', bodyPhrase: 'a noticeably heavyset build' }))
      .toBe(`ohwx woman, shaved head, leather jacket, a noticeably heavyset build, ${portraitSpec.prompt}`)
  })

  it('body phrase only (no descriptor, no trigger)', () => {
    expect(buildPortraitPrompt(portraitSpec, { bodyPhrase: 'a noticeably heavyset build' }))
      .toBe(`a noticeably heavyset build, ${portraitSpec.prompt}`)
  })
})

describe('buildDerivedPrompt', () => {
  it('appends the descriptor as a wardrobe clause when present', () => {
    expect(buildDerivedPrompt(bodyFrontSpec, 'a red leather jacket'))
      .toBe(`${bodyFrontSpec.prompt} The person wears a red leather jacket.`)
  })

  it('returns the bare panel prompt when no descriptor', () => {
    expect(buildDerivedPrompt(bodyFrontSpec)).toBe(bodyFrontSpec.prompt)
  })

  // Critical 1: the body phrase must NEVER be folded into the "The person
  // wears …" wardrobe clause — a body isn't clothing. It gets appended as
  // its own sentence instead, composed here as full-string assertions for
  // all three combinations.
  it('wardrobe + body phrase — two separate sentences, body phrase NOT inside the wears-clause', () => {
    expect(buildDerivedPrompt(bodyFrontSpec, 'a red leather jacket', 'a noticeably heavyset build'))
      .toBe(`${bodyFrontSpec.prompt} The person wears a red leather jacket. They have a noticeably heavyset build.`)
  })

  it('body phrase only — no wears-clause at all when descriptor is absent', () => {
    expect(buildDerivedPrompt(bodyFrontSpec, undefined, 'a noticeably heavyset build'))
      .toBe(`${bodyFrontSpec.prompt} They have a noticeably heavyset build.`)
  })

  it('wardrobe only — unchanged when no body phrase (byte-identical to pre-body-phrase behavior)', () => {
    expect(buildDerivedPrompt(bodyFrontSpec, 'a red leather jacket', undefined))
      .toBe(`${bodyFrontSpec.prompt} The person wears a red leather jacket.`)
  })
})

describe('useSheetGeneration — expandAll (money guard)', () => {
  const photoSource: SheetSource = { mode: 'photo', referenceImageDataUrl: 'data:image/png;base64,REF' }

  it('portrait failure aborts before any derived call', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/cloud-train/character-shot') {
        return { ok: false, status: 500, json: async () => ({}) } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const gen = useSheetGeneration()
    await gen.expandAll(photoSource)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(gen.panels.value[0]!.error).toBe(true)
    // No derived call ran for any of the 4 remaining panels.
    expect(gen.panels.value.slice(1).every((p) => p.dataUrl === null && !p.loading && !p.error)).toBe(true)
  })

  it('portrait success + body-front failure stops before body-back', async () => {
    let nanoCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/cloud-train/character-shot') {
        return { ok: true, status: 200, json: async () => ({ imageDataUrl: 'data:image/png;base64,PORTRAIT' }) } as Response
      }
      if (url === '/api/inpaint/nano-gen') {
        nanoCalls++
        return { ok: false, status: 500, json: async () => ({}) } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const gen = useSheetGeneration()
    await gen.expandAll(photoSource)

    expect(nanoCalls).toBe(1) // only body-front was attempted
    expect(gen.panels.value[0]!.dataUrl).toBe('data:image/png;base64,PORTRAIT')
    expect(gen.panels.value[1]!.error).toBe(true) // body-front
    expect(gen.panels.value[2]!.dataUrl).toBeNull() // body-back never ran
    expect(gen.panels.value[2]!.loading).toBe(false)
  })
})

describe('useSheetGeneration — rerollPanel', () => {
  const photoSource: SheetSource = { mode: 'photo', referenceImageDataUrl: 'data:image/png;base64,REF' }

  it('derived reroll with a present portrait issues exactly one nano-gen call carrying the portrait dataUrl in images', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      if (url === '/api/inpaint/nano-gen') {
        const body = JSON.parse(init.body)
        expect(body.images).toEqual(['data:image/png;base64,PORTRAIT'])
        return { ok: true, status: 200, json: async () => ({ images: ['data:image/png;base64,SMILE'] }) } as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const gen = useSheetGeneration()
    gen.panels.value[0]!.dataUrl = 'data:image/png;base64,PORTRAIT' // portrait already generated

    await gen.rerollPanel('face-smile', photoSource)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const face = gen.panels.value.find((p) => p.spec.slot === 'face-smile')!
    expect(face.dataUrl).toBe('data:image/png;base64,SMILE')
  })

  it('derived reroll with no portrait yet errors without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const gen = useSheetGeneration()
    await expect(gen.rerollPanel('face-smile', photoSource)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
