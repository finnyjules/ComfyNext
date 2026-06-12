import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, isAbsolute, normalize, sep } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.cache')
const CACHE_FILE = join(CACHE_DIR, 'history.json')

// The history cache (frontend/server/routes/history/index.get.ts) merges
// `{ ...cached, ...live }` and never evicts. Over time it accumulates entries
// whose output files have been deleted on disk — those keep re-surfacing as
// ghost cards in the AssetsPanel. This route walks the cache, drops any
// entry whose every output file is missing, and rewrites the cache.

// Resolved once: the ComfyUI output directory. The Nuxt dev server runs at
// repo_root/frontend, so output lives one level up.
const OUTPUT_DIR = join(process.cwd(), '..', 'output')

function outputExists(filename: string, subfolder: string): boolean {
  if (!filename || isAbsolute(filename) || isAbsolute(subfolder || '')) return false
  const candidate = normalize(join(OUTPUT_DIR, subfolder || '', filename))
  if (!candidate.startsWith(normalize(OUTPUT_DIR) + sep)) return false
  return existsSync(candidate)
}

function entryHasAnySurvivor(entry: any): boolean {
  const outputs = entry?.outputs
  if (!outputs || typeof outputs !== 'object') return false
  for (const nodeOut of Object.values(outputs)) {
    for (const key of ['images', 'gifs', 'audio', 'video']) {
      const arr = (nodeOut as any)?.[key]
      if (!Array.isArray(arr)) continue
      for (const f of arr) {
        if (f?.type !== 'output') continue
        if (outputExists(f.filename, f.subfolder || '')) return true
      }
    }
  }
  return false
}

export default defineEventHandler(async () => {
  if (!existsSync(CACHE_FILE)) {
    return { ok: true, before: 0, after: 0, removed: 0 }
  }
  let cached: Record<string, any>
  try {
    cached = JSON.parse(await readFile(CACHE_FILE, 'utf-8'))
  }
  catch {
    return { ok: false, error: 'cache unreadable' }
  }

  const before = Object.keys(cached).length
  const survivors: Record<string, any> = {}
  for (const [pid, entry] of Object.entries(cached)) {
    if (entryHasAnySurvivor(entry)) survivors[pid] = entry
  }
  const after = Object.keys(survivors).length

  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(survivors))
  }
  catch (err) {
    return { ok: false, error: String(err) }
  }
  return { ok: true, before, after, removed: before - after }
})
