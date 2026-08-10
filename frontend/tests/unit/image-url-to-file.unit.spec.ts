import { describe, it, expect, vi, afterEach } from 'vitest'
import { imageUrlToFile } from '~/lib/canvas/imageUrlToFile'

function stubFetch(impl: { ok: boolean; status?: number; blob?: Blob }) {
  ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: impl.ok,
    status: impl.status ?? 200,
    blob: async () => impl.blob,
  })
}
afterEach(() => { vi.restoreAllMocks() })

describe('imageUrlToFile', () => {
  it('names the File from the URL ?filename= param', async () => {
    stubFetch({ ok: true, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })
    const f = await imageUrlToFile('/view?filename=foo.png&type=input')
    expect(f).toBeInstanceOf(File)
    expect(f.name).toBe('foo.png')
    expect(f.type).toBe('image/png')
  })

  it('falls back to the given name when there is no filename param', async () => {
    stubFetch({ ok: true, blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) })
    const f = await imageUrlToFile('blob:whatever', 'pasted.png')
    expect(f.name).toBe('pasted.png')
  })

  it('throws on a non-ok response', async () => {
    stubFetch({ ok: false, status: 404 })
    await expect(imageUrlToFile('/view?filename=x.png')).rejects.toThrow(/404/)
  })

  it('throws when the blob is not an image', async () => {
    stubFetch({ ok: true, blob: new Blob(['hi'], { type: 'text/plain' }) })
    await expect(imageUrlToFile('/view?filename=x.txt')).rejects.toThrow(/not an image/)
  })
})
