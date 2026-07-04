import { describe, it, expect, afterEach, vi } from 'vitest'
import { uploadMediaFile, addMediaRows, IMAGE_ACCEPT } from '~/lib/collection/upload'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'

describe('IMAGE_ACCEPT', () => {
  it('is the widening seam for v1 image-only accept', () => {
    expect(IMAGE_ACCEPT).toBe('image/*')
  })
})

describe('addMediaRows', () => {
  it('appends one row per url, copying the preview row and overriding columnKey, without sweep flag', () => {
    const c = createCollection('t')
    addColumn(c, 'team', 'text')
    addColumn(c, 'photo', 'image')
    const r = addRow(c)
    setCell(c, r.id, 'team', 'France')
    c.previewRow = 0

    const added = addMediaRows(c, 'photo', ['/view?filename=a.png', '/view?filename=b.png'])

    expect(added).toHaveLength(2)
    expect(c.rows).toHaveLength(3)
    for (const [i, url] of ['/view?filename=a.png', '/view?filename=b.png'].entries()) {
      const row = added[i]
      expect(row.sweep).toBeFalsy()
      expect(row.values.team).toBe('France')
      expect(row.values.photo).toBe(url)
    }
  })

  it('clamps the preview row first, so an out-of-range previewRow still copies the last row', () => {
    const c = createCollection('t')
    addColumn(c, 'label', 'text')
    const r = addRow(c)
    setCell(c, r.id, 'label', 'only-row')
    c.previewRow = 99 // out of range

    const added = addMediaRows(c, 'photo', ['/view?filename=x.png'])

    expect(added[0].values.label).toBe('only-row')
    expect(c.previewRow).toBe(0)
  })

  it('uses an empty values object as the base when the collection has no rows', () => {
    const c = createCollection('t')
    const added = addMediaRows(c, 'photo', ['/view?filename=a.png', '/view?filename=b.png'])
    expect(added).toHaveLength(2)
    expect(added[0].values).toEqual({ photo: '/view?filename=a.png' })
    expect(added[1].values).toEqual({ photo: '/view?filename=b.png' })
  })

  it('returns exactly the appended rows, in order', () => {
    const c = createCollection('t')
    addRow(c)
    const added = addMediaRows(c, 'photo', ['/view?filename=a.png', '/view?filename=b.png'])
    expect(c.rows.slice(-2)).toEqual(added)
  })
})

describe('uploadMediaFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('happy path: POSTs to /upload/image and returns a /view URL built from the response', async () => {
    let seenUrl: string | undefined
    let seenBody: FormData | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenBody = init?.body as FormData
      return new Response(JSON.stringify({ name: 'collection_upload_123_my-photo.png', subfolder: 'collections' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['fake-bytes'], 'My Photo.png', { type: 'image/png' })
    const url = await uploadMediaFile(file)

    expect(seenUrl).toBe('/upload/image')
    expect(seenBody).toBeInstanceOf(FormData)
    expect(seenBody!.get('overwrite')).toBe('true')
    const uploaded = seenBody!.get('image') as File
    expect(uploaded.name).toContain('my-photo')
    expect(uploaded.name).toMatch(/^collection_upload_/)

    expect(url).toContain('filename=collection_upload_123_my-photo.png')
    expect(url).toContain('type=input')
    expect(url).toContain('subfolder=collections')
  })

  it('throws when the upload response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadMediaFile(file)).rejects.toThrow('upload failed')
  })

  it('falls back to the sanitized filename when the response omits subfolder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'foo.png' }), { status: 200 })))
    const file = new File(['x'], 'foo.png', { type: 'image/png' })
    const url = await uploadMediaFile(file)
    expect(url).toContain('filename=foo.png')
    expect(url).not.toContain('subfolder=')
  })
})
