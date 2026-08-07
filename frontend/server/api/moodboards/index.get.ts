/** List every saved moodboard (full entries — readings are tiny). */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateMoodboardEntry, type MoodboardEntry } from '../../../shared/taste/moodboard'

const DIR = join(process.cwd(), 'server', 'moodboards')

export default defineEventHandler(async () => {
  let files: string[] = []
  try {
    files = (await readdir(DIR)).filter(f => f.endsWith('.json'))
  } catch {
    return { moodboards: [] } // directory missing on fresh checkouts
  }
  const moodboards: MoodboardEntry[] = []
  for (const f of files) {
    try {
      moodboards.push(validateMoodboardEntry(JSON.parse(await readFile(join(DIR, f), 'utf8'))))
    } catch { /* skip corrupt entries; never 500 the whole list */ }
  }
  moodboards.sort((a, b) => a.name.localeCompare(b.name))
  return { moodboards }
})
