// List castable characters. Records self-heal on read: refs whose input-dir
// file vanished are dropped and the healed record is written back.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { healRefImages, parseCharacterRecord } from '~~/server/utils/characterRegistry'

export default defineEventHandler(async () => {
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  const inputDir = path.resolve(process.cwd(), '..', 'input')
  let files: string[]
  try { files = await fs.readdir(dir) } catch { return { characters: [] } }

  // Capture readdir success explicitly. If the input dir listing fails (missing,
  // transient FS error, etc.), `existing` stays null and we must NOT heal: healing
  // against an empty/failed listing would read as "every ref is missing" and wipe
  // refImages on every record, then write that back — an irreversible data loss
  // from one transient error. Skip healing entirely in that case.
  let existing: Set<string> | null = null
  try { existing = new Set(await fs.readdir(inputDir)) } catch { /* input dir unreadable — do not heal */ }

  const characters = []
  for (const f of files.filter(f => f.endsWith('.json'))) {
    const slug = f.slice(0, -5)
    let parsed
    try { parsed = parseCharacterRecord(await fs.readFile(path.join(dir, f), 'utf8'), slug) }
    catch { continue }
    if (!parsed) continue
    if (existing === null) {
      characters.push(parsed)
      continue
    }
    const { record, dropped } = healRefImages(parsed, name => existing!.has(name))
    if (dropped) {
      record.updatedAt = new Date().toISOString()
      await fs.writeFile(path.join(dir, f), JSON.stringify(record, null, 2)).catch(() => {})
    }
    characters.push(record)
  }
  characters.sort((a, b) => a.name.localeCompare(b.name))
  return { characters }
})
