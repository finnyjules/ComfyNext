import { describe, it, expect } from 'vitest'
import { matchDatasetFolder, parseDatasetStartMs, type DatasetFolder } from '../../server/utils/datasetMatch'

function folder(name: string, startMs: number, imageCount = 16): DatasetFolder {
  return { name, startMs, imageCount }
}

// A fixed anchor so tests don't depend on the clock.
const FINISH = '2026-06-30T07:13:41.000Z'
const finishMs = Date.parse(FINISH)

describe('parseDatasetStartMs', () => {
  it('parses the trailing ms of a lora_dataset folder', () => {
    expect(parseDatasetStartMs('lora_dataset_1780111518173')).toBe(1780111518173)
  })
  it('rejects non-matching names', () => {
    expect(parseDatasetStartMs('lora_dataset_')).toBeNull()
    expect(parseDatasetStartMs('input')).toBeNull()
    expect(parseDatasetStartMs('lora_dataset_abc')).toBeNull()
  })
})

describe('matchDatasetFolder', () => {
  it('matches the nearest folder starting just before the finish time', () => {
    const folders = [
      folder('a', finishMs - 90 * 60_000), // 90 min before
      folder('b', finishMs - 18 * 60_000), // 18 min before  ← nearest
      folder('c', finishMs - 150 * 60_000), // 150 min before
    ]
    const m = matchDatasetFolder(FINISH, folders)
    expect(m?.folder.name).toBe('b')
    expect(Math.round(m!.gapMinutes)).toBe(18)
  })

  it('ignores folders that start after the finish time', () => {
    const folders = [
      folder('after', finishMs + 5 * 60_000),
      folder('before', finishMs - 30 * 60_000),
    ]
    expect(matchDatasetFolder(FINISH, folders)?.folder.name).toBe('before')
  })

  it('returns null when every folder is outside the window', () => {
    const folders = [folder('old', finishMs - 5 * 60 * 60_000)] // 5h before
    expect(matchDatasetFolder(FINISH, folders)).toBeNull()
  })

  it('honours a custom window', () => {
    const folders = [folder('x', finishMs - 200 * 60_000)]
    expect(matchDatasetFolder(FINISH, folders)).toBeNull() // default 180
    expect(matchDatasetFolder(FINISH, folders, 240)?.folder.name).toBe('x')
  })

  it('returns null for an unparseable or missing trained_on', () => {
    const folders = [folder('x', finishMs - 10 * 60_000)]
    expect(matchDatasetFolder(null, folders)).toBeNull()
    expect(matchDatasetFolder('not-a-date', folders)).toBeNull()
  })

  it('skips folders with an invalid start timestamp', () => {
    const folders = [folder('bad', 0), folder('good', finishMs - 12 * 60_000)]
    expect(matchDatasetFolder(FINISH, folders)?.folder.name).toBe('good')
  })
})
