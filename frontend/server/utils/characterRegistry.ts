/**
 * Pure helpers for the character registry (models/characters/<slug>.json).
 * Reference images live in the ComfyUI INPUT dir and records store filenames —
 * a cast ref is exactly `/view?filename=<name>&type=input`, which the Shot
 * Director ref chain already resolves. Pure (fs-free) so it unit-tests like
 * loraPrompt.ts; the endpoints own the IO.
 */

export interface CharacterRecord {
  name: string
  slug: string
  /** Ordered ComfyUI input-dir filenames — the canonical reference sheet. */
  refImages: string[]
  coverIndex: number
  /** Optional link to a trained LoRA sidecar in models/loras (opt-in). */
  loraName: string | null
  trigger: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export function slugifyCharacterName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function validRefFilename(name: string): boolean {
  return typeof name === 'string' && name.length > 0
    && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

export function parseCharacterRecord(raw: string, slug: string): CharacterRecord | null {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return null }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const r = obj as Record<string, unknown>
  const refImages = (Array.isArray(r.refImages) ? r.refImages : [])
    .filter((f): f is string => validRefFilename(f as string))
  const cover = typeof r.coverIndex === 'number' ? r.coverIndex : 0
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : slug,
    slug,
    refImages,
    coverIndex: Math.min(Math.max(0, cover), Math.max(0, refImages.length - 1)),
    loraName: typeof r.loraName === 'string' && r.loraName ? r.loraName : null,
    trigger: typeof r.trigger === 'string' && r.trigger ? r.trigger : null,
    notes: typeof r.notes === 'string' ? r.notes : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  }
}

/** Drop refs whose input-dir file vanished (self-healing list). */
export function healRefImages(
  record: CharacterRecord,
  exists: (filename: string) => boolean,
): { record: CharacterRecord, dropped: number } {
  const kept = record.refImages.filter(exists)
  const dropped = record.refImages.length - kept.length
  if (!dropped) return { record, dropped: 0 }
  return {
    record: {
      ...record,
      refImages: kept,
      coverIndex: Math.min(record.coverIndex, Math.max(0, kept.length - 1)),
    },
    dropped,
  }
}
