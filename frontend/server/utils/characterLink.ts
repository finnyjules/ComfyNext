/**
 * Shared server-side helper: link a just-succeeded character-kind LoRA
 * training to the character registry (models/characters/<slug>.json).
 *
 * Extracted so both finalize paths — the legacy /api/cloud-train/status
 * poll endpoint and the training-queue's pollLora() in trainingProviders.ts
 * — flip a matching draft to ready (or create a fresh record) the same way,
 * instead of only one of them doing it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseCharacterRecord, slugifyCharacterName, type CharacterRecord } from '~~/server/utils/characterRegistry'

/**
 * Pure match: does an existing registry record correspond to a just-trained
 * character LoRA? Matched by slugified display name — the same key the
 * absorb bridge uses — so a hand-created draft (e.g. from "Train identity")
 * flips to ready on the record the user was already looking at, instead of
 * spawning a duplicate.
 */
function matchesTrainedCharacter(record: CharacterRecord, displayNameSlug: string): boolean {
  return record.slug === displayNameSlug
}

/**
 * Link a just-succeeded character-kind LoRA training to the registry: flip a
 * matching draft to ready (loraName/trigger only — variants are untouched),
 * or create a fresh record with an empty Default variant if none exists.
 * Best-effort — callers should catch and log rather than let a failure here
 * fail the finalize path, since the weights are already safely on disk by
 * the time this runs.
 */
export async function linkTrainedCharacter(opts: { displayName: string, weightsFilename: string, trigger: string | null }): Promise<void> {
  const { displayName, weightsFilename, trigger } = opts
  const slug = slugifyCharacterName(displayName)
  if (!slug) return
  const dir = path.resolve(process.cwd(), '..', 'models', 'characters')
  await fs.mkdir(dir, { recursive: true })

  let files: string[] = []
  try { files = await fs.readdir(dir) } catch { /* none yet */ }

  let match: CharacterRecord | null = null
  for (const f of files.filter(f => f.endsWith('.json'))) {
    const s = f.slice(0, -5)
    let parsed: CharacterRecord | null = null
    try { parsed = parseCharacterRecord(await fs.readFile(path.join(dir, f), 'utf8'), s) } catch { continue }
    if (parsed && matchesTrainedCharacter(parsed, slug)) { match = parsed; break }
  }

  const now = new Date().toISOString()
  if (match) {
    match.loraName = weightsFilename
    match.trigger = trigger
    match.updatedAt = now
    await fs.writeFile(path.join(dir, `${match.slug}.json`), JSON.stringify(match, null, 2))
    return
  }

  const record: CharacterRecord = {
    name: displayName,
    slug,
    variants: [{ id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 }],
    loraName: weightsFilename,
    trigger,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
  await fs.writeFile(path.join(dir, `${slug}.json`), JSON.stringify(record, null, 2))
}
