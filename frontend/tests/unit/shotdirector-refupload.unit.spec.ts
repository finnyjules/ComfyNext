import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadRefFile, viewRefUrl } from '~/lib/shotdirector/refUpload'

describe('viewRefUrl', () => {
  it('builds an input-dir view URL', () => {
    expect(viewRefUrl('ref_1.png')).toBe('/view?filename=ref_1.png&type=input')
  })

  it('URL-encodes the filename', () => {
    expect(viewRefUrl('my ref.png')).toBe('/view?filename=my+ref.png&type=input')
  })
})

describe('uploadRefFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads and returns the view URL for the stored name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'sd-ref_123_photo.png' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const url = await uploadRefFile(new File(['x'], 'photo.png', { type: 'image/png' }))
    expect(url).toBe(viewRefUrl('sd-ref_123_photo.png'))
    const [target, init] = fetchMock.mock.calls[0]!
    expect(target).toBe('/upload/image')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('throws on a failed upload (caller falls back to a data URL)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(uploadRefFile(new File(['x'], 'a.png'))).rejects.toThrow('upload 500')
  })

  it('throws when the response has no name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await expect(uploadRefFile(new File(['x'], 'a.png'))).rejects.toThrow('no name')
  })
})
