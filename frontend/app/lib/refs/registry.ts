/**
 * Project-scoped named image references (`@refs`). A handle like `@tracksuit`
 * maps to a ComfyUI input-dir filename an image widget can load, plus optional
 * text used for Mode 1 prompt substitution. Keys are bare (no leading '@').
 */
export interface RefEntry {
  /** ComfyUI input-dir filename an image widget consumes (e.g. 'suit.png'). */
  filename: string
  /** Optional expansion for `@name` inside a prompt (descriptor / trigger word). */
  text?: string
}
export type RefRegistry = Record<string, RefEntry>

/** Bare, storable handle from raw user text, or null if there's nothing valid. */
export function normalizeRefName(raw: string): string | null {
  const stripped = (raw || '').trim().replace(/^@+/, '').trim()
  const collapsed = stripped.replace(/\s+/g, '-')
  return /^[a-zA-Z0-9_-]+$/.test(collapsed) ? collapsed : null
}

export function setRef(reg: RefRegistry, name: string, entry: RefEntry): RefRegistry {
  const key = normalizeRefName(name)
  if (!key) return reg
  return { ...reg, [key]: entry }
}

export function resolveRef(reg: RefRegistry, name: string): RefEntry | undefined {
  const key = normalizeRefName(name)
  return key ? reg[key] : undefined
}

export function resolveRefFilename(reg: RefRegistry, name: string): string | undefined {
  return resolveRef(reg, name)?.filename
}

export function resolveRefText(reg: RefRegistry, name: string): string | undefined {
  const t = resolveRef(reg, name)?.text
  return t && t.trim() ? t.trim() : undefined
}

export function renameRef(reg: RefRegistry, from: string, to: string): RefRegistry {
  const fromKey = normalizeRefName(from)
  const toKey = normalizeRefName(to)
  if (!fromKey || !toKey || !(fromKey in reg)) return reg
  if (fromKey === toKey) return reg
  const next: RefRegistry = { ...reg }
  next[toKey] = next[fromKey]!
  delete next[fromKey]
  return next
}

export function removeRef(reg: RefRegistry, name: string): RefRegistry {
  const key = normalizeRefName(name)
  if (!key || !(key in reg)) return reg
  const next: RefRegistry = { ...reg }
  delete next[key]
  return next
}

export function listRefNames(reg: RefRegistry): string[] {
  return Object.keys(reg).sort((a, b) => a.localeCompare(b))
}
