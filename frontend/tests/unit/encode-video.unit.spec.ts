import { describe, it, expect, vi } from 'vitest'
import { encodeFrames } from '../../app/lib/engine/encodeVideo'

const opts = { frames: ['a.png', 'b.png'], fps: 30, width: 640, height: 360 }

function fetchReturning(body: unknown, ok = true) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok,
    json: async () => body,
  }))
}

describe('encodeFrames', () => {
  it('omits alpha from the POST body when not requested', async () => {
    const fetchImpl = fetchReturning({ filename: 'spacetype_1.mp4' })
    await encodeFrames(opts, fetchImpl as any)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/sailor/spacetype_encode')
    const sent = JSON.parse(init.body as string)
    expect(sent).toEqual({ frames: opts.frames, fps: 30, width: 640, height: 360 })
    expect('alpha' in sent).toBe(false)
  })

  it('includes alpha: true in the POST body when requested', async () => {
    const fetchImpl = fetchReturning({ filename: 'spacetype_1.webm' })
    await encodeFrames({ ...opts, alpha: true }, fetchImpl as any)
    const [, init] = fetchImpl.mock.calls[0]!
    const sent = JSON.parse(init.body as string)
    expect(sent.alpha).toBe(true)
  })

  it('derives ext "mp4" from an .mp4 response filename', async () => {
    const fetchImpl = fetchReturning({ filename: 'spacetype_123.mp4' })
    const result = await encodeFrames(opts, fetchImpl as any)
    expect(result).toEqual({ filename: 'spacetype_123.mp4', ext: 'mp4' })
  })

  it('derives ext "webm" from a .webm response filename, regardless of request alpha', async () => {
    // The server is authoritative: even though this request didn't ask for alpha,
    // trust whatever extension the response actually contains.
    const fetchImpl = fetchReturning({ filename: 'spacetype_123.webm' })
    const result = await encodeFrames(opts, fetchImpl as any)
    expect(result).toEqual({ filename: 'spacetype_123.webm', ext: 'webm' })
  })

  it('rejects with a useful message when the server returns no filename', async () => {
    const fetchImpl = fetchReturning({ error: 'ffmpeg not found' }, false)
    await expect(encodeFrames(opts, fetchImpl as any)).rejects.toThrow(/ffmpeg not found/)
  })

  it('rejects with a useful message when the response body is unparseable', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => { throw new Error('bad json') },
    }))
    await expect(encodeFrames(opts, fetchImpl as any)).rejects.toThrow(/encode/i)
  })

  it('rejects when the network request itself throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down') })
    await expect(encodeFrames(opts, fetchImpl as any)).rejects.toThrow(/network down/)
  })
})
