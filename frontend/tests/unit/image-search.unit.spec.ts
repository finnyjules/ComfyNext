import { describe, it, expect } from 'vitest'
import { imageDimensionsFromBytes, normalizeBraveImageResults } from '~~/server/utils/imageSearch'
import { orderBySize, isSmallImage } from '~/lib/imageSearchResults'
import { describeCanvas, searchImageRequests, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import type { Command } from '~/lib/agent/commandSurface'

// A realistic Brave Image Search API payload (api.search.brave.com/res/v1/images/search).
const BRAVE_PAYLOAD = {
  type: 'images',
  query: { original: 'kylian mbappe france jersey' },
  results: [
    {
      type: 'image_result',
      title: 'Kylian Mbappé celebrates for France',
      url: 'https://example.com/article/mbappe-celebrates',
      source: 'example.com',
      properties: { url: 'https://cdn.example.com/full/mbappe1.jpg', placeholder: 'data:image/png;base64,x' },
      thumbnail: { src: 'https://imgs.search.brave.com/thumb1.jpg' },
    },
    {
      type: 'image_result',
      title: 'Mbappé full body shot',
      url: 'https://other.com/photo',
      source: 'other.com',
      properties: { url: 'https://cdn.other.com/mbappe2.jpg' },
      thumbnail: { src: 'https://imgs.search.brave.com/thumb2.jpg' },
    },
  ],
}

describe('normalizeBraveImageResults', () => {
  it('maps Brave image results to { id, title, thumbUrl, imageUrl, pageUrl, source }', () => {
    const out = normalizeBraveImageResults(BRAVE_PAYLOAD)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      title: 'Kylian Mbappé celebrates for France',
      thumbUrl: 'https://imgs.search.brave.com/thumb1.jpg',
      imageUrl: 'https://cdn.example.com/full/mbappe1.jpg',
      pageUrl: 'https://example.com/article/mbappe-celebrates',
      source: 'example.com',
    })
    // ids are unique so the picker grid can key + select on them
    expect(new Set(out.map(r => r.id)).size).toBe(2)
  })

  it('drops entries missing a full-size image url or a thumbnail', () => {
    const out = normalizeBraveImageResults({
      results: [
        { title: 'no image', url: 'https://a.com', properties: {}, thumbnail: { src: 'https://t.com/x.jpg' } },
        { title: 'no thumb', url: 'https://b.com', properties: { url: 'https://b.com/full.jpg' }, thumbnail: {} },
        { title: 'ok', url: 'https://c.com', properties: { url: 'https://c.com/full.jpg' }, thumbnail: { src: 'https://t.com/c.jpg' } },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.title).toBe('ok')
  })

  it('returns [] for malformed payloads without throwing', () => {
    expect(normalizeBraveImageResults(null)).toEqual([])
    expect(normalizeBraveImageResults({})).toEqual([])
    expect(normalizeBraveImageResults({ results: 'nope' })).toEqual([])
    expect(normalizeBraveImageResults(42)).toEqual([])
  })

  it('carries the original dimensions through when Brave provides them', () => {
    const out = normalizeBraveImageResults({
      results: [
        { title: 'sized', url: 'https://a.com', properties: { url: 'https://a.com/full.jpg', width: 1920, height: 1080 }, thumbnail: { src: 'https://t.com/a.jpg' } },
        { title: 'unsized', url: 'https://b.com', properties: { url: 'https://b.com/full.jpg' }, thumbnail: { src: 'https://t.com/b.jpg' } },
        { title: 'junk-sized', url: 'https://c.com', properties: { url: 'https://c.com/full.jpg', width: 'big', height: -4 }, thumbnail: { src: 'https://t.com/c.jpg' } },
      ],
    })
    expect(out[0]).toMatchObject({ width: 1920, height: 1080 })
    expect(out[1]!.width).toBeUndefined()
    expect(out[2]!.width).toBeUndefined() // non-numeric / negative junk is dropped
  })

  it('only keeps http(s) urls (no data:/javascript: smuggling into the picker)', () => {
    const out = normalizeBraveImageResults({
      results: [
        { title: 'bad', url: 'https://a.com', properties: { url: 'javascript:alert(1)' }, thumbnail: { src: 'https://t.com/a.jpg' } },
        { title: 'ok', url: 'https://b.com', properties: { url: 'https://b.com/full.jpg' }, thumbnail: { src: 'https://t.com/b.jpg' } },
      ],
    })
    expect(out.map(r => r.title)).toEqual(['ok'])
  })
})

// ── imageDimensionsFromBytes: header sniffing on a partial download ──────────
function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // signature
  b.set([0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52], 8) // IHDR length + type
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
function gifBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(16)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a
  new DataView(b.buffer).setUint16(6, w, true)
  new DataView(b.buffer).setUint16(8, h, true)
  return b
}
function jpegBytes(w: number, h: number): Uint8Array {
  // SOI · APP0 (16 bytes) · SOF0 with the dimensions
  const b = new Uint8Array(64)
  let i = 0
  b.set([0xFF, 0xD8], i); i += 2
  b.set([0xFF, 0xE0, 0x00, 0x10], i); i += 4 + 14 // APP0, length 16 (14 payload after the 2 length bytes)
  b.set([0xFF, 0xC0, 0x00, 0x11, 0x08], i) // SOF0, length, precision
  new DataView(b.buffer).setUint16(i + 5, h)
  new DataView(b.buffer).setUint16(i + 7, w)
  return b
}
function webpVp8xBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40)
  b.set([0x52, 0x49, 0x46, 0x46]) // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  b.set([0x56, 0x50, 0x38, 0x58], 12) // VP8X
  const put24 = (off: number, v: number) => { b[off] = v & 0xFF; b[off + 1] = (v >> 8) & 0xFF; b[off + 2] = (v >> 16) & 0xFF }
  put24(24, w - 1)
  put24(27, h - 1)
  return b
}

describe('imageDimensionsFromBytes', () => {
  it('reads PNG dimensions from the IHDR', () => {
    expect(imageDimensionsFromBytes(pngBytes(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })
  it('reads GIF dimensions from the logical screen descriptor', () => {
    expect(imageDimensionsFromBytes(gifBytes(500, 320))).toEqual({ width: 500, height: 320 })
  })
  it('reads JPEG dimensions from the SOF marker (skipping other segments)', () => {
    expect(imageDimensionsFromBytes(jpegBytes(2048, 1365))).toEqual({ width: 2048, height: 1365 })
  })
  it('reads WebP dimensions from a VP8X chunk', () => {
    expect(imageDimensionsFromBytes(webpVp8xBytes(1600, 900))).toEqual({ width: 1600, height: 900 })
  })
  it('returns null for unknown or truncated data', () => {
    expect(imageDimensionsFromBytes(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(imageDimensionsFromBytes(new Uint8Array(0))).toBeNull()
    expect(imageDimensionsFromBytes(new TextEncoder().encode('<html>not an image</html>'))).toBeNull()
  })
})

// ── orderBySize / isSmallImage: picker-side quality cues ─────────────────────
const R = (id: string, w?: number, h?: number) => ({ id, title: id, thumbUrl: 't', imageUrl: 'i', pageUrl: 'p', source: 's', width: w, height: h })

describe('orderBySize', () => {
  it('keeps relevance order but sinks small images (long edge < 800) to the end', () => {
    const out = orderBySize([R('big1', 1920, 1080), R('small1', 400, 267), R('unknown'), R('big2', 800, 600), R('small2', 640, 480)])
    expect(out.map(r => r.id)).toEqual(['big1', 'unknown', 'big2', 'small1', 'small2'])
  })
  it('treats unknown-size results as adequate (not punished)', () => {
    expect(isSmallImage(R('u'))).toBe(false)
    expect(isSmallImage(R('s', 400, 267))).toBe(true)
    expect(isSmallImage(R('tall-small', 500, 799))).toBe(true)
    expect(isSmallImage(R('tall-ok', 500, 800))).toBe(false)
  })
})

function graph(): CanvasSnapshot {
  return { nodes: [], edges: [] }
}

describe('searchImages command (canvas surface)', () => {
  it('is offered to the model with a hint', () => {
    const cmd = describeCanvas(graph()).commands.find(c => c.op === 'searchImages')
    expect(cmd).toBeTruthy()
    expect(cmd!.hint).toMatch(/search/i)
  })

  it('searchImageRequests extracts valid queries from a command list', () => {
    const cmds: Command[] = [
      { op: 'searchImages', args: { query: 'kylian mbappe full body france jersey' } },
      { op: 'setWidget', target: '1', args: { name: 'steps', value: 30 } },
    ]
    expect(searchImageRequests(cmds)).toEqual(['kylian mbappe full body france jersey'])
  })

  it('searchImageRequests ignores missing/empty/non-string queries and dedupes', () => {
    const cmds: Command[] = [
      { op: 'searchImages', args: { query: '  ' } },
      { op: 'searchImages' },
      { op: 'searchImages', args: { query: 42 as unknown as string } },
      { op: 'searchImages', args: { query: 'poodle' } },
      { op: 'searchImages', args: { query: 'poodle' } },
    ]
    expect(searchImageRequests(cmds)).toEqual(['poodle'])
  })
})
