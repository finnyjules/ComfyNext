import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  depthStatusFor, depthImageFor, depthMessageFor, requestDepth, onDepthChange,
  depthUrl, depthKey, depthSourceFromViewUrl, __resetDepthRegistry,
} from '~/lib/compositor/depthRegistry'

beforeEach(() => { __resetDepthRegistry(); vi.restoreAllMocks() })

describe('depthUrl', () => {
  it('passes subfolder as its own param — /view proxies to ComfyUI, which needs it', () => {
    expect(depthUrl('depth_abc.png', 'sailor_depth'))
      .toBe('/view?filename=depth_abc.png&subfolder=sailor_depth&type=input')
  })
  it('encodes values rather than interpolating them raw', () => {
    // URLSearchParams uses form encoding, so a space becomes '+' rather than '%20'.
    // Either is decoded correctly server-side; what matters is that nothing is raw.
    const url = depthUrl('a b.png', 'x y')
    expect(url).not.toContain(' ')
    expect(url).toContain('filename=a+b.png')
    expect(url).toContain('subfolder=x+y')
  })
})

describe('depthRegistry', () => {
  it('starts idle and reads synchronously as null', () => {
    expect(depthStatusFor('a.png')).toBe('idle')
    expect(depthImageFor('a.png')).toBeNull()
  })

  it('goes loading immediately on request, without awaiting', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    requestDepth('a.png')
    expect(depthStatusFor('a.png')).toBe('loading')
  })

  it('only fetches once per filename', () => {
    const f = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', f)
    requestDepth('a.png'); requestDepth('a.png'); requestDepth('a.png')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty filename', () => {
    const f = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', f)
    requestDepth('')
    expect(f).not.toHaveBeenCalled()
  })

  it('records an error and notifies, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })))
    const seen = vi.fn()
    onDepthChange(seen)
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
    expect(seen).toHaveBeenCalled()
    expect(depthImageFor('a.png')).toBeNull()
    expect(depthMessageFor('a.png')).toContain('502')
  })

  it('surfaces a response with no depthFilename as an error, not a silent pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
  })

  it('allows a retry after an error', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500 }))
    vi.stubGlobal('fetch', f)
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
    requestDepth('a.png')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const seen = vi.fn()
    onDepthChange(seen)()
    requestDepth('a.png')
    await vi.waitFor(() => expect(depthStatusFor('a.png')).toBe('error'))
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('depthKey — wired/local parity', () => {
  it('defaults a bare filename to the input root', () => {
    expect(depthKey('a.png')).toBe(depthKey({ filename: 'a.png', type: 'input' }))
  })
  it('does NOT confuse the same basename in different roots', () => {
    // A wired execution output and an uploaded file can share a name.
    expect(depthKey({ filename: 'a.png', type: 'output' }))
      .not.toBe(depthKey({ filename: 'a.png', type: 'input' }))
  })
  it('distinguishes subfolders', () => {
    expect(depthKey({ filename: 'a.png', subfolder: 'x', type: 'output' }))
      .not.toBe(depthKey({ filename: 'a.png', type: 'output' }))
  })
})

describe('requestDepth for a wired image', () => {
  it('posts the root and subfolder so the server reads the right directory', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    requestDepth({ filename: 'out.png', subfolder: 'sub', type: 'output' })
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body).toEqual({ filename: 'out.png', subfolder: 'sub', type: 'output' })
  })

  it('tracks a wired and a local image with the same name independently', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    requestDepth({ filename: 'same.png', type: 'output' })
    expect(depthStatusFor({ filename: 'same.png', type: 'output' })).toBe('loading')
    expect(depthStatusFor({ filename: 'same.png', type: 'input' })).toBe('idle')
  })
})

describe('depthSourceFromViewUrl', () => {
  it('parses a wired execution output', () => {
    expect(depthSourceFromViewUrl('/view?filename=out_001.png&type=output'))
      .toEqual({ filename: 'out_001.png', subfolder: undefined, type: 'output' })
  })
  it('carries a subfolder through', () => {
    expect(depthSourceFromViewUrl('/view?filename=a.png&subfolder=sub&type=temp'))
      .toEqual({ filename: 'a.png', subfolder: 'sub', type: 'temp' })
  })
  it('defaults a missing type to input', () => {
    expect(depthSourceFromViewUrl('/view?filename=a.png')?.type).toBe('input')
  })
  it('returns null for a live studio slot — there is no file to read', () => {
    expect(depthSourceFromViewUrl('live:3')).toBeNull()
  })
  it('returns null for junk rather than guessing', () => {
    expect(depthSourceFromViewUrl('')).toBeNull()
    expect(depthSourceFromViewUrl(null)).toBeNull()
    expect(depthSourceFromViewUrl('/view?type=output')).toBeNull()      // no filename
    expect(depthSourceFromViewUrl('/view?filename=a.png&type=etc')).toBeNull()
  })
  it('round-trips into a usable key', () => {
    const src = depthSourceFromViewUrl('/view?filename=a.png&type=output')!
    expect(depthKey(src)).toBe(depthKey({ filename: 'a.png', type: 'output' }))
  })
})
