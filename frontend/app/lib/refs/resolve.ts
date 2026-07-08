import { resolveRefText, type RefRegistry } from './registry'

/** Matches `@name` handles (letters, digits, underscore, hyphen). */
export const REF_TOKEN_RE = /@([a-zA-Z0-9_-]+)/g

/**
 * Mode 1: replace `@name` in a prompt with the reference's text expansion.
 * Unknown refs, and known refs with no text, are left verbatim so nothing is
 * silently dropped.
 */
export function substituteRefTokens(text: string, reg: RefRegistry): string {
  if (!text || text.indexOf('@') === -1) return text
  return text.replace(REF_TOKEN_RE, (whole, name) => resolveRefText(reg, name) ?? whole)
}
