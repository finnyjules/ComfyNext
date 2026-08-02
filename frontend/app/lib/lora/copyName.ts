/**
 * Pick an unused display name for a duplicated style: "X copy", then "X copy 2",
 * "X copy 3"… The server 409s on a taken name, so without this the second
 * duplicate of the same style would just error instead of working.
 *
 * Duplicating a copy re-uses the ORIGINAL's stem rather than stacking suffixes,
 * so you get "X copy 2" instead of "X copy copy".
 */
const COPY_SUFFIX_RE = /\s+copy(\s+\d+)?$/i

export function nextCopyName(name: string, existing: string[]): string {
  const stem = (name || '').trim().replace(COPY_SUFFIX_RE, '').trim()
  const taken = new Set(existing.map(n => (n || '').trim().toLowerCase()))

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem} copy` : `${stem} copy ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
