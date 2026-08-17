/**
 * Stage 5 round-2 security review — F2 and F4.
 *
 * F2: GET /object_info was on the hosted raw allowlist because it "looks
 * static". It is not. ComfyUI builds the LoadImage-family combos by LISTING
 * the input directory, which is shared across tenants until Stage 6 — so every
 * hosted user could read every other user's uploaded filenames, which are also
 * exactly the keys /view checks ownership against. The canvas genuinely needs
 * this endpoint (direct execution's graphToPrompt validates against these
 * schemas client-side), so the response is scrubbed rather than refused.
 *
 * R3 (round 3): emptying the filename LIST is not the whole leak. ComfyUI seeds
 * a COMBO's `default` from the first entry of the same directory listing, so
 * AudioWaveform.audio_file still carried the alphabetically-first filename in
 * the shared input dir after the round-2 scrub.
 *
 * F4 moved out to engine-upload-ownership.unit.spec.ts when the blanket
 * overwrite refusal became an ownership check.
 *
 * The fixture is a REAL /object_info capture (trimmed filename lists) from the
 * dev engine, so it carries the shapes ComfyUI actually emits rather than the
 * one shape a scrubber author would imagine.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { scrubObjectInfo, handleHostedObjectInfo } = await import('../../server/utils/engineGate')

const FIXTURE = fileURLToPath(new URL('./fixtures/object-info-sample.json', import.meta.url))
const catalogText = readFileSync(FIXTURE, 'utf8')
const catalog = () => JSON.parse(catalogText)

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

beforeEach(() => { fetchMock.mockReset() })

// NB: pass `null` for the no-session case — an explicit `undefined` would
// silently fall back to the default parameter and test a signed-in user.
const ev = (path: string, userId: string | null = 'u1') => ({ path, context: { userId } }) as any

// ------------------------------------------------------------------ F2 pure

describe('scrubObjectInfo — the shared input directory never leaves the server', () => {
  it('empties the LEGACY [[files], {image_upload}] combo', () => {
    const before = catalog()
    expect(before.LoadImage.input.required.image[0].length).toBeGreaterThan(0)

    const after = scrubObjectInfo(before) as any
    expect(after.LoadImage.input.required.image[0]).toEqual([])
    expect(after.LoadImageMask.input.required.image[0]).toEqual([])
  })

  it('empties the V2 ["COMBO", {options: [files], *_upload}] combo', () => {
    // The shape a scrubber that only knows the documented tuple form misses
    // entirely — audio/video/3D pickers moved to `options` inside the dict.
    const before = catalog()
    expect(before.LoadAudio.input.required.audio[1].options.length).toBeGreaterThan(0)
    expect(before.LoadVideo.input.required.file[1].options.length).toBeGreaterThan(0)

    const after = scrubObjectInfo(before) as any
    expect(after.LoadAudio.input.required.audio[1].options).toEqual([])
    expect(after.LoadVideo.input.required.file[1].options).toEqual([])
  })

  it('leaks no filename from the real capture anywhere in the scrubbed payload', () => {
    const before = catalog()
    const names = [
      ...before.LoadImage.input.required.image[0],
      ...before.LoadImageMask.input.required.image[0],
      ...before.LoadAudio.input.required.audio[1].options,
      ...before.LoadVideo.input.required.file[1].options,
    ]
    expect(names.length).toBeGreaterThan(0)

    const serialized = JSON.stringify(scrubObjectInfo(before))
    for (const n of names) expect(serialized, `leaked ${n}`).not.toContain(n)
  })

  it('R3 — blanks the DEFAULT, which carries a filename of its own', () => {
    // A real capture: ComfyUI seeds this default with options[0], so the round-2
    // scrubber emptied the list and shipped "Happiness.mp3" anyway.
    const before = catalog()
    const leaked = before.AudioWaveform.input.required.audio_file[1].default
    expect(leaked, 'fixture must carry a real leaking default').toBeTruthy()
    expect(before.AudioWaveform.input.required.audio_file[1].options).toContain(leaked)

    const after = scrubObjectInfo(before) as any
    expect(after.AudioWaveform.input.required.audio_file[1].default).toBe('')
    expect(JSON.stringify(after), `leaked ${leaked}`).not.toContain(leaked)
  })

  it('R3 — leaves defaults on NON-upload widgets alone', () => {
    const before = catalog()
    const after = scrubObjectInfo(before) as any
    expect(after.AudioWaveform.input.required.width).toEqual(before.AudioWaveform.input.required.width)
    expect(after.CLIPTextEncode).toEqual(before.CLIPTextEncode)
  })

  it('PRESERVES the upload flags — the widget must still be an upload widget', () => {
    const after = scrubObjectInfo(catalog()) as any
    expect(after.LoadImage.input.required.image[1].image_upload).toBe(true)
    expect(after.LoadAudio.input.required.audio[1].audio_upload).toBe(true)
    expect(after.LoadVideo.input.required.file[1].video_upload).toBe(true)
  })

  it('leaves every non-upload combo and node schema byte-identical', () => {
    // graphToPrompt validates against these client-side: drop or reorder a
    // node definition and every hosted render breaks.
    const before = catalog()
    const after = scrubObjectInfo(before) as any

    expect(Object.keys(after)).toEqual(Object.keys(before))
    // Same node, two combos: one is an upload picker, one is a plain enum.
    expect(after.LoadImageMask.input.required.channel).toEqual(before.LoadImageMask.input.required.channel)
    expect(after.LatentUpscale).toEqual(before.LatentUpscale)
    expect(after.CLIPTextEncode).toEqual(before.CLIPTextEncode)
    // Flag present but no inline list — must be untouched, not crashed on.
    expect(after.Painter).toEqual(before.Painter)
    expect(after.LoadImageOutput).toEqual(before.LoadImageOutput)
    // Everything on the scrubbed nodes except the filename array survives.
    expect(after.LoadImage.output).toEqual(before.LoadImage.output)
    expect(after.LoadImage.input_order).toEqual(before.LoadImage.input_order)
    expect(Object.keys(after.LoadImage)).toEqual(Object.keys(before.LoadImage))
  })

  it('does not mutate its input', () => {
    const before = catalog()
    scrubObjectInfo(before)
    expect(before.LoadImage.input.required.image[0].length).toBeGreaterThan(0)
  })

  it('survives malformed catalogs rather than 500-ing the canvas', () => {
    expect(scrubObjectInfo(null)).toBe(null)
    expect(scrubObjectInfo({ N: {} })).toEqual({ N: {} })
    expect(scrubObjectInfo({ N: { input: null } })).toEqual({ N: { input: null } })
    expect(scrubObjectInfo({ N: { input: { required: 'nope' } } })).toEqual({ N: { input: { required: 'nope' } } })
  })
})

// --------------------------------------------------------------- F2 handler

describe('handleHostedObjectInfo', () => {
  it('scrubs what the engine returns', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => catalog() })
    const out = await handleHostedObjectInfo(ev('/object_info')) as any
    expect(out.LoadImage.input.required.image[0]).toEqual([])
    expect(out.LatentUpscale).toEqual(catalog().LatentUpscale)
  })

  it('scrubs the single-node form too (/object_info/LoadImage)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ LoadImage: catalog().LoadImage }) })
    const out = await handleHostedObjectInfo(ev('/object_info/LoadImage')) as any
    expect(out.LoadImage.input.required.image[0]).toEqual([])
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/object_info/LoadImage')
  })

  it('preserves ?comfyWorker=N targeting — node availability differs per worker', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => catalog() })
    await handleHostedObjectInfo(ev('/object_info?comfyWorker=2'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/object_info')
  })

  it('strips the /comfyui base like the raw proxy did', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => catalog() })
    await handleHostedObjectInfo(ev('/comfyui/object_info'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/object_info')
  })

  it('requires a session, and reports an engine failure as 502', async () => {
    await expect(handleHostedObjectInfo(ev('/object_info', null))).rejects.toMatchObject({ statusCode: 401 })
    fetchMock.mockResolvedValue({ ok: false })
    await expect(handleHostedObjectInfo(ev('/object_info'))).rejects.toMatchObject({ statusCode: 502 })
  })
})
