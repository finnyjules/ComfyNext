/** Server-side twin of HouseStyle (server utils must not import from app/). */
export interface HouseStyleEntry {
  id: string
  label: string
  useCases: string[]
  trigger: string
  tasteProfile: string
  replicateModel: string
  weightsUrl: string
  thumbnails: string[]
  examplePrompts: string[]
  suggestedScale?: number
}

const WEIGHTS_TAR_RE = /^https:\/\/replicate\.delivery\/[^/]+\/[^/]+\/trained_model\.tar$/

function isModelRef(value: string): boolean {
  const s = (value || '').trim()
  if (!s || s.includes('://') || s.includes(':')) return false
  const low = s.toLowerCase()
  if (low.endsWith('.safetensors')) return false
  if (low.includes('huggingface.co') || low.includes('civitai.com') || low.startsWith('hf.co/')) return false
  const parts = s.split('/').filter(Boolean)
  return parts.length === 2 || parts.length === 3
}

export function validateHouseStyleEntry(e: unknown): string[] {
  const errors: string[] = []
  const entry = e as Partial<HouseStyleEntry> | null
  if (!entry || typeof entry !== 'object') return ['entry must be an object']
  if (!entry.id || !/^[a-z0-9-]+$/.test(entry.id)) errors.push('id must be kebab-case')
  if (!entry.label?.trim()) errors.push('label required')
  if (!Array.isArray(entry.useCases) || entry.useCases.length === 0) errors.push('at least one use-case tag required')
  if (!entry.trigger?.trim()) errors.push('trigger required')
  if (!entry.tasteProfile || entry.tasteProfile.trim().length <= 40)
    errors.push('taste profile required (>40 chars) — trigger-only styles land weak')
  if (!entry.replicateModel || !isModelRef(entry.replicateModel))
    errors.push('replicateModel must be a bare owner/model ref (no version hash, no URL)')
  if (!entry.weightsUrl || !WEIGHTS_TAR_RE.test(entry.weightsUrl))
    errors.push('weightsUrl must be a replicate.delivery trained_model.tar')
  if (!Array.isArray(entry.thumbnails) || entry.thumbnails.length !== 4)
    errors.push('exactly 4 thumbnails required')
  if (!Array.isArray(entry.examplePrompts) || entry.examplePrompts.length === 0)
    errors.push('at least one example prompt required')
  return errors
}

export function upsertHouseStyle(entries: HouseStyleEntry[], entry: HouseStyleEntry): HouseStyleEntry[] {
  const rest = entries.filter(e => e.replicateModel !== entry.replicateModel)
  return [...rest, entry].sort((a, b) => a.label.localeCompare(b.label))
}

/** Same id, different replicateModel = would shadow the existing entry's thumbnail dir. */
export function findIdCollision(entries: HouseStyleEntry[], entry: HouseStyleEntry): HouseStyleEntry | undefined {
  return entries.find(e => e.id === entry.id && e.replicateModel !== entry.replicateModel)
}

const WEBP_DATA_RE = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/

/**
 * Pure decode + validate for one `data:image/webp;base64,...` thumbnail.
 * Returns the decoded buffer, or null on any parse/format failure — callers
 * decode all thumbnails up front so a bad one never leaves earlier writes
 * orphaned on disk.
 */
export function decodeWebpThumbnail(dataUrl: string): Buffer | null {
  const m = WEBP_DATA_RE.exec(dataUrl || '')
  if (!m) return null
  let buf: Buffer
  try {
    buf = Buffer.from(m[1], 'base64')
  } catch {
    return null
  }
  const isWebp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
  return isWebp ? buf : null
}
