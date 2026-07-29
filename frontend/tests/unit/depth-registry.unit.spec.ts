import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  depthStatusFor, depthImageFor, depthMessageFor, requestDepth, onDepthChange,
  depthUrl, __resetDepthRegistry,
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
