/** Collapse whitespace, strip wrapping quotes/space, hard-cap length.
 *  It's a prompt prefix, not an essay. */
export function cleanProfile(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 600)
}

/** Parse the vision model's output into a Krea-shaped taste profile:
 *  a prose paragraph plus a list of short style keywords. The model is
 *  prompted to write the paragraph, then a single `Keywords: a, b, c` line. */
export function parseAestheticOutput(
  raw: string,
): { aesthetic: string; keywords: string[] } {
  const m = raw.match(/keywords\s*:/i)
  if (!m || m.index === undefined) {
    return { aesthetic: cleanProfile(raw), keywords: [] }
  }
  const prose = raw.slice(0, m.index)
  const after = raw.slice(m.index + m[0].length)
  // Keywords sit on the label's own line — stop at the first newline.
  const line = after.split(/\r?\n/)[0] ?? ''
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const part of line.split(',')) {
    const kw = part.trim()
    if (!kw) continue
    const key = kw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(kw)
    if (keywords.length >= 12) break
  }
  return { aesthetic: cleanProfile(prose), keywords }
}
