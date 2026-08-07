/** Moodboard — the taste-read style object (spec 2026-08-06). Library owns; nodes reference. */
export interface MoodboardReading {
  summary: string
  palette: { name: string; hex: string }[] // CURATED (Fable-named) — never raw k-means
  avoids: string[]
}
export interface MoodboardEntry {
  id: string; name: string; createdAt: string; updatedAt: string
  folder: string // input/moodboard_<ms> image folder
  reading: MoodboardReading
}

export const MOODBOARD_ID_RE = /^[a-z0-9-]{1,64}$/
export const MOODBOARD_FOLDER_RE = /^moodboard_\d+$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function validateMoodboardEntry(raw: unknown): MoodboardEntry {
  const e = raw as Partial<MoodboardEntry> | null
  if (!e || typeof e !== 'object') throw new Error('entry must be an object')
  if (typeof e.id !== 'string' || !MOODBOARD_ID_RE.test(e.id)) throw new Error('invalid id')
  if (typeof e.name !== 'string' || !e.name.trim()) throw new Error('name is required')
  if (typeof e.folder !== 'string' || !MOODBOARD_FOLDER_RE.test(e.folder)) throw new Error('invalid folder')
  const r = e.reading as Partial<MoodboardReading> | undefined
  if (!r || typeof r !== 'object') throw new Error('reading is required')
  if (typeof r.summary !== 'string' || !r.summary.trim()) throw new Error('summary is required — never save without a reading')
  const palette = Array.isArray(r.palette) ? r.palette : []
  for (const p of palette) {
    if (!p || typeof p.name !== 'string' || typeof p.hex !== 'string' || !HEX_RE.test(p.hex)) throw new Error('palette hex must be #rrggbb with a name')
  }
  const avoids = (Array.isArray(r.avoids) ? r.avoids : []).filter((a): a is string => typeof a === 'string' && !!a.trim())
  return {
    id: e.id, name: e.name.trim(),
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date().toISOString(),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString(),
    folder: e.folder,
    reading: { summary: r.summary.trim(), palette, avoids },
  }
}
