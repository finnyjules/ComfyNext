/** List every saved moodboard (full entries — readings are tiny). */
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { validateMoodboardEntry, type MoodboardEntry } from '../../../shared/taste/moodboard'
import { listOwned } from '../../utils/ownedJsonStore'
import { storeDir } from '../../utils/dataDir'

const OPTS = { kind: 'moodboard', dir: storeDir('moodboards') }

async function readAllMoodboards(): Promise<Array<{ id: string, record: MoodboardEntry }>> {
  let files: string[] = []
  try {
    files = (await readdir(OPTS.dir)).filter(f => f.endsWith('.json'))
  } catch {
    return [] // directory missing on fresh checkouts
  }
  const out: Array<{ id: string, record: MoodboardEntry }> = []
  for (const f of files) {
    try {
      out.push({ id: basename(f, '.json'), record: validateMoodboardEntry(JSON.parse(await readFile(join(OPTS.dir, f), 'utf8'))) })
    } catch { /* skip corrupt entries; never 500 the whole list */ }
  }
  return out
}

export default defineEventHandler(async (event) => {
  const moodboards = await listOwned(OPTS, event.context.userId ?? null, readAllMoodboards)
  moodboards.sort((a, b) => a.name.localeCompare(b.name))
  return { moodboards }
})
