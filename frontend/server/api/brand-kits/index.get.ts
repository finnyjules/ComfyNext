/** List every saved brand kit (full entries — kits are tiny). */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KITS_DIR = join(process.cwd(), 'server', 'brand-kits')

export default defineEventHandler(async () => {
  let files: string[] = []
  try {
    files = (await readdir(KITS_DIR)).filter(f => f.endsWith('.json'))
  } catch {
    return { kits: [] } // directory missing on fresh checkouts
  }
  const kits = []
  for (const f of files) {
    try {
      kits.push(JSON.parse(await readFile(join(KITS_DIR, f), 'utf8')))
    } catch { /* skip corrupt file */ }
  }
  kits.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { kits }
})
