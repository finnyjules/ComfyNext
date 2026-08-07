import { describe, expect, it } from 'vitest'
import { createApp, eventHandler, toWebHandler } from 'h3'
import { safeImageFile } from '../../server/utils/moodboardImages'
import { readUploadForm } from '../../server/utils/multipart'
import { MOODBOARD_FOLDER_RE } from '../../shared/taste/moodboard'

describe('moodboard image guards', () => {
  it('accepts plain image names, rejects traversal and non-images', () => {
    expect(safeImageFile('a.png')).toBe(true)
    expect(safeImageFile('b.JPEG')).toBe(true)
    for (const bad of ['../a.png', 'a/../b.png', 'a\\b.png', 'x.svg', 'x.png.exe', '']) {
      expect(safeImageFile(bad), bad).toBe(false)
    }
  })
  it('folder guard admits only moodboard_<digits>', () => {
    expect(MOODBOARD_FOLDER_RE.test('moodboard_1786000000000')).toBe(true)
    for (const bad of ['lora_dataset_1', 'moodboard_', 'moodboard_1/..', 'MOODBOARD_1']) {
      expect(MOODBOARD_FOLDER_RE.test(bad), bad).toBe(false)
    }
  })
})

// The upload route takes MULTIPLE parts under one `images` field; the shared
// multipart util grew a `files()` accessor for that. Route through a real h3
// app (the multipart-upload spec's harness) so it sees a genuine H3Event.
describe('readUploadForm().files', () => {
  function webHandlerListing() {
    const app = createApp()
    app.use(eventHandler(async (event) => {
      const form = await readUploadForm(event)
      const files = await form.files('images')
      return { names: files.map(f => f.filename), sizes: files.map(f => f.data.byteLength) }
    }))
    return toWebHandler(app)
  }

  it('returns every part under the field, in order, skipping empties', async () => {
    const body = new FormData()
    body.append('images', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    body.append('images', new File([new Uint8Array([4, 5])], 'b.png', { type: 'image/png' }))
    body.append('images', new File([], 'empty.png', { type: 'image/png' }))
    body.append('folder', 'moodboard_1')
    const res = await webHandlerListing()(new Request('http://localhost/upload', { method: 'POST', body }))
    expect(await res.json()).toEqual({ names: ['a.png', 'b.png'], sizes: [3, 2] })
  })

  it('absent field → empty list', async () => {
    const body = new FormData()
    body.append('folder', 'moodboard_1')
    const res = await webHandlerListing()(new Request('http://localhost/upload', { method: 'POST', body }))
    expect(await res.json()).toEqual({ names: [], sizes: [] })
  })
})
