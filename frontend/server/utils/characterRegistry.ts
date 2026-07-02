/**
 * Pure helpers for the character registry (models/characters/<slug>.json).
 * Reference images live in the ComfyUI INPUT dir and records store filenames —
 * a cast ref is exactly `/view?filename=<name>&type=input`, which the Shot
 * Director ref chain already resolves. Pure (fs-free) so it unit-tests like
 * loraPrompt.ts; the endpoints own the IO.
 */

export interface CharacterVariant {
  id: string
  label: string
  /** Look descriptor folded into sheet-generation prompts ("short bob, yellow raincoat"). */
  descriptor: string
  refImages: string[]
  coverIndex: number
}

export interface CharacterRecord {
  name: string
  slug: string
  /** Ordered variants, each with its own reference sheet. */
  variants: CharacterVariant[]
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

  const hygiene = (v: Record<string, unknown>): CharacterVariant | null => {
    if (typeof v.id !== 'string' || !v.id || typeof v.label !== 'string' || !v.label) return null
    const refImages = (Array.isArray(v.refImages) ? v.refImages : [])
      .filter((f): f is string => validRefFilename(f as string))
    const cover = typeof v.coverIndex === 'number' ? v.coverIndex : 0
    return {
      id: v.id, label: v.label,
      descriptor: typeof v.descriptor === 'string' ? v.descriptor : '',
      refImages,
      coverIndex: Math.min(Math.max(0, cover), Math.max(0, refImages.length - 1)),
    }
  }

  let variants = (Array.isArray(r.variants) ? r.variants : [])
    .map(v => hygiene(v as Record<string, unknown>))
    .filter((v): v is CharacterVariant => !!v)

  if (!variants.length && Array.isArray(r.refImages)) {
    // Legacy single-sheet record → Default variant (migration is parse-time;
    // the next write persists the new shape).
    const legacy = hygiene({ id: 'default', label: 'Default', descriptor: '', refImages: r.refImages, coverIndex: r.coverIndex ?? 0 })
    if (legacy) variants = [legacy]
  }

  if (!variants.some(v => v.id === 'default')) {
    variants.unshift({ id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0 })
  } else {
    variants = [...variants.filter(v => v.id === 'default'), ...variants.filter(v => v.id !== 'default')]
  }

  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : slug,
    slug,
    variants,
    loraName: typeof r.loraName === 'string' && r.loraName ? r.loraName : null,
    trigger: typeof r.trigger === 'string' && r.trigger ? r.trigger : null,
    notes: typeof r.notes === 'string' ? r.notes : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  }
}

/** Drop refs whose input-dir file vanished across ALL variants (self-healing list). */
export function healRefImages(
  record: CharacterRecord,
  exists: (filename: string) => boolean,
): { record: CharacterRecord, dropped: number } {
  let totalDropped = 0
  const healed = record.variants.map(v => {
    const kept = v.refImages.filter(exists)
    const dropped = v.refImages.length - kept.length
    totalDropped += dropped
    return {
      ...v,
      refImages: kept,
      coverIndex: Math.min(v.coverIndex, Math.max(0, kept.length - 1)),
    }
  })
  if (!totalDropped) return { record, dropped: 0 }
  return {
    record: { ...record, variants: healed },
    dropped: totalDropped,
  }
}

export function defaultVariant(record: CharacterRecord): CharacterVariant {
  return record.variants.find(v => v.id === 'default') ?? record.variants[0]!
}
