/** Assemble a prose paragraph + keyword list into the Krea taste-profile shape:
 *  the paragraph, a blank line, then the keywords joined with ", ".
 *  Shuffle-free by design — the caller shuffles keywords before calling so this
 *  stays deterministic and testable. Mirrors importKreaBoard's format. */
export function assembleAesthetic(prose: string, keywords: string[]): string {
  let out = (prose || '').trim()
  const tail = (keywords || []).map((k) => k.trim()).filter(Boolean).join(', ')
  if (tail) out = out ? `${out}\n\n${tail}` : tail
  return out
}
