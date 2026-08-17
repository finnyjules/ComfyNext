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
 * F4: ComfyUI's image_upload() honours an `overwrite` form field. Verified in
 * server.py: WITHOUT it the handler auto-suffixes `name (1).png` in a
 * `while os.path.exists` loop and can never clobber; WITH it the write is
 * unconditional. Shared input dir + guessed name = another tenant's asset
 * replaced. Hosted refuses the field and forwards the identical bytes.
 *
 * The fixture is a REAL /object_info capture (trimmed filename lists) from the
 * dev engine, so it carries the shapes ComfyUI actually emits rather than the
 * one shape a scrubber author would imagine.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rawBody = vi.fn(async () => undefined as Buffer | undefined)
const requestHeader = vi.fn((_e: any, _n: string) => 'multipart/form-data; boundary=XYZ' as string | undefined)
vi.mock('h3', async (orig) => {
  const actual = await orig() as any
  return {
    ...actual,
    readRawBody: (...a: any[]) => rawBody(...(a as [])),
    getRequestHeader: (...a: any[]) => requestHeader(...(a as [any, string])),
    setResponseStatus: () => {},
  }
})

const {
  scrubObjectInfo, bodyDeclaresOverwrite, handleHostedObjectInfo, handleHostedUpload,
} = await import('../../server/utils/engineGate')

const FIXTURE = fileURLToPath(new URL('./fixtures/object-info-sample.json', import.meta.url))
const catalogText = readFileSync(FIXTURE, 'utf8')
const catalog = () => JSON.parse(catalogText)

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

beforeEach(() => {
  fetchMock.mockReset()
  rawBody.mockReset()
  rawBody.mockResolvedValue(undefined)
  requestHeader.mockReturnValue('multipart/form-data; boundary=XYZ')
})

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

// ------------------------------------------------------------------ F4 pure

const boundary = '----WebKitFormBoundaryABC'
function multipart(parts: [string, string][]): Buffer {
  const chunks = parts.map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  return Buffer.from(chunks.join('') + `--${boundary}--\r\n`, 'latin1')
}

describe('bodyDeclaresOverwrite', () => {
  it('detects the overwrite field', () => {
    expect(bodyDeclaresOverwrite(multipart([['image', 'x'], ['overwrite', 'true']]))).toBe(true)
    expect(bodyDeclaresOverwrite(multipart([['overwrite', 'false']]))).toBe(true)
    expect(bodyDeclaresOverwrite(multipart([['overwrite', '1']]))).toBe(true)
  })

  it('is case-insensitive and tolerates unquoted names', () => {
    expect(bodyDeclaresOverwrite(Buffer.from('CONTENT-DISPOSITION: form-data; NAME="overwrite"\r\n'))).toBe(true)
    expect(bodyDeclaresOverwrite(Buffer.from('content-disposition: form-data; name=overwrite\r\n'))).toBe(true)
  })

  it('passes an ordinary upload', () => {
    expect(bodyDeclaresOverwrite(multipart([['image', 'x'], ['type', 'input'], ['subfolder', '']]))).toBe(false)
    expect(bodyDeclaresOverwrite(undefined)).toBe(false)
    expect(bodyDeclaresOverwrite(Buffer.alloc(0))).toBe(false)
  })

  it('does not fire on a field merely NAMED like it, or on image bytes', () => {
    // A part called `overwrite_note` is a different field.
    expect(bodyDeclaresOverwrite(multipart([['overwrite_note', 'x']]))).toBe(false)
    // Raw pixel data containing the literal string must not 403 the upload.
    expect(bodyDeclaresOverwrite(Buffer.from('\x89PNG\r\n...name="overwrite"...\x00'))).toBe(false)
  })
})

// --------------------------------------------------------------- F4 handler

describe('handleHostedUpload', () => {
  it('REFUSES an upload that declares overwrite (cross-tenant clobber)', async () => {
    rawBody.mockResolvedValue(multipart([['image', 'x'], ['overwrite', 'true']]))
    await expect(handleHostedUpload(ev('/upload/image'))).rejects.toMatchObject({ statusCode: 403 })
    expect(fetchMock, 'must not reach the engine').not.toHaveBeenCalled()
  })

  it('forwards a clean upload with byte-identical body and the original content-type', async () => {
    const body = multipart([['image', 'hello'], ['type', 'input']])
    rawBody.mockResolvedValue(body)
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{"name":"hello.png"}' })

    const out = await handleHostedUpload(ev('/upload/image'))
    expect(out).toEqual({ name: 'hello.png' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8188/upload/image')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('multipart/form-data; boundary=XYZ')
    expect(Buffer.compare(init.body as Buffer, body), 'forwarded bytes must be identical').toBe(0)
  })

  it('reads the body exactly once — the request stream is single-shot', async () => {
    rawBody.mockResolvedValue(multipart([['image', 'x']]))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{}' })
    await handleHostedUpload(ev('/upload/image'))
    expect(rawBody).toHaveBeenCalledTimes(1)
  })

  it('preserves ?comfyWorker=N and the /comfyui base', async () => {
    rawBody.mockResolvedValue(multipart([['image', 'x']]))
    fetchMock.mockResolvedValue({ status: 200, text: async () => '{}' })

    await handleHostedUpload(ev('/upload/image?comfyWorker=2'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8191/upload/image')

    fetchMock.mockClear()
    await handleHostedUpload(ev('/comfyui/upload/mask'))
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8188/upload/mask')
  })

  it('requires a session', async () => {
    await expect(handleHostedUpload(ev('/upload/image', null))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('passes a non-JSON engine response through instead of throwing', async () => {
    rawBody.mockResolvedValue(multipart([['image', 'x']]))
    fetchMock.mockResolvedValue({ status: 400, text: async () => 'Bad Request' })
    expect(await handleHostedUpload(ev('/upload/image'))).toBe('Bad Request')
  })
})
