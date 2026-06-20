import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractBoardImages, parseKreaBoard } from '~~/server/api/krea/parse'

// A faithful slice of a real public moodboard-feed RSC payload:
//   - the target board object: imageCount:8, styleName/tasteProfile/keywords,
//     and its own images:[…] array of 16 image objects
//   - relatedMoodboards:[…] — 12 OTHER boards, each with a singular imageUrl:"…"
// The page-wide scrape bug swept those 12 thumbnails into the board.
const payload = readFileSync(
  fileURLToPath(new URL('./fixtures/krea-board.payload.txt', import.meta.url)),
  'utf8',
)

// The first relatedMoodboards thumbnail — must NOT leak into the board.
const RELATED_THUMB = 'https://gen.krea.ai/images/9adf167b-a487-40ed-9b0c-08cb33323c9b.png'

describe('Krea moodboard scrape scoping', () => {
  it('extracts ONLY the board\'s own images, not relatedMoodboards thumbnails', () => {
    const imgs = extractBoardImages(payload)
    expect(imgs.length).toBe(16)
    expect(new Set(imgs.map((i) => i.url)).size).toBe(16)
    expect(imgs.map((i) => i.url)).not.toContain(RELATED_THUMB)
  })

  it('regression: a page-wide scrape would return 28, scoped returns 16', () => {
    // Whole payload holds 16 board + 12 related = 28 unique gen URLs.
    const all = payload.match(/https:\/\/gen\.krea\.ai\/images\/[a-f0-9-]+\.png/g) || []
    expect(new Set(all).size).toBe(28)
    expect(extractBoardImages(payload).length).toBe(16)
  })

  it('parses board metadata and image dimensions', () => {
    const board = parseKreaBoard(payload)
    expect(board).not.toBeNull()
    expect(board!.name).toBe('Monochrome Academic Realism')
    expect(board!.imageCount).toBe(16) // array is ground truth; the stale imageCount:8 field is ignored
    expect(board!.images[0]!.width).toBe(832)
    expect(board!.images[0]!.height).toBe(1248)
    expect(board!.positiveKeywords).toContain('academic realism')
    expect(board!.aesthetic).toMatch(/monochrome/i)
    expect(board!.previewImages).toHaveLength(4)
  })

  it('returns null when the page has no board images array', () => {
    expect(parseKreaBoard('relatedMoodboards:[{imageUrl:"https://gen.krea.ai/images/x.png"}]')).toBeNull()
  })
})
