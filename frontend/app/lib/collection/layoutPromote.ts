import { keyFromLabel } from './model'

/** Matches `{{ props.name }}` tokens anywhere in a JSON-stringified template
 * (mirrors bindables.ts's PROP_RE — same token grammar). */
const PROP_RE = /\{\{\s*props\.([a-z0-9_]+)\s*\}\}/gi

/** Matches a string that is EXACTLY one `{{ props.name }}` token, tolerating
 * leading/trailing whitespace around the token and inside the braces, but
 * rejecting any other surrounding content. */
const WHOLE_TOKEN_RE = /^\s*\{\{\s*props\.([a-z0-9_]+)\s*\}\}\s*$/i

const KIND_PREFIX: Record<'text' | 'image', string> = {
  text: 'text_layer_',
  image: 'image_layer_',
}

/** Scans a Smart Layout template for socket names already in use — both as
 * `{{ props.<prefix>N }}` tokens and as element `role: "<PREFIX>_N"` fields
 * (role matching is case-insensitive) — and returns the first free
 * `<prefix>N` name (1-based) for the given kind. */
export function nextFreeSocket(template: unknown, kind: 'text' | 'image'): string {
  const prefix = KIND_PREFIX[kind]
  const taken = new Set<number>()

  const json = (() => { try { return JSON.stringify(template ?? {}) } catch { return '' } })()
  let m: RegExpExecArray | null
  PROP_RE.lastIndex = 0
  while ((m = PROP_RE.exec(json))) {
    const name = m[1]!
    if (name.toLowerCase().startsWith(prefix)) {
      const n = Number(name.slice(prefix.length))
      if (Number.isInteger(n) && n > 0) taken.add(n)
    }
  }

  const roleRe = new RegExp(`^${prefix}(\\d+)$`, 'i')
  const seen = new Set<object>()
  const walkRoles = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node as object)) return
    seen.add(node as object)
    if (Array.isArray(node)) { for (const item of node) walkRoles(item); return }
    const obj = node as Record<string, unknown>
    const role = obj.role
    if (typeof role === 'string') {
      const rm = roleRe.exec(role)
      if (rm) {
        const n = Number(rm[1])
        if (Number.isInteger(n) && n > 0) taken.add(n)
      }
    }
    for (const key of Object.keys(obj)) walkRoles(obj[key])
  }
  walkRoles(template)

  let n = 1
  while (taken.has(n)) n++
  return `${prefix}${n}`
}

/** Pure: returns the element's prior content so the caller can seed the
 * promoted collection cell, before patching the element's own content to
 * `{{ props.<socketName> }}`. Does not mutate `el`. */
export function tokenizeElementContent(
  el: { content?: string },
  _socketName: string,
): { priorContent: string } {
  return { priorContent: el.content ?? '' }
}

const MAX_CONTENT_SLUG_LEN = 24

/** Priority chain for the new collection column's label: element name, then
 * role (lowercased), then a slug of the element's prior content (truncated to
 * ~24 chars before slugging), then the socket name as a final fallback.
 * Never returns an empty string. */
export function columnLabelForElement(
  el: { name?: string; role?: string; content?: string },
  priorContent: string,
  socketName?: string,
): string {
  const name = (el.name ?? '').trim()
  if (name) return name

  const role = (el.role ?? '').trim()
  if (role) return role.toLowerCase()

  const truncated = priorContent.slice(0, MAX_CONTENT_SLUG_LEN)
  const slug = keyFromLabel(truncated, [])
  if (slug && slug !== 'column') return slug

  return socketName ?? 'value'
}

/** Returns the socket name (e.g. `text_layer_1`) when `content` is EXACTLY
 * one `{{ props.x }}` token (whitespace around/inside the braces tolerated),
 * else null — used to detect whether an element is currently bound. */
export function isBoundToken(content: string | undefined): string | null {
  if (!content) return null
  const m = WHOLE_TOKEN_RE.exec(content)
  return m ? m[1]! : null
}
