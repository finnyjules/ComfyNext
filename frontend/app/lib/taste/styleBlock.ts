/**
 * Taste → diffusion-prompt style block, for the /dev/taste-wall generation row
 * (the diffusion twin of the wall's fixed-composition discipline: same subject
 * prompt rendered neutral vs. with this block appended).
 *
 * Pure string composition so it's unit-testable: summary → "In the style of:",
 * palette hexes → "palette:", the Fable reading's avoids → "avoid:". Empty or
 * whitespace-only parts are omitted entirely (no dangling labels).
 */
export interface TasteStyleParts {
  summary?: string | null
  palette?: string[] | null
  avoids?: string[] | null
}

/** Compose the style block alone. Returns '' when every part is empty. */
export function tasteStyleBlock(parts: TasteStyleParts): string {
  const bits: string[] = []
  const summary = parts.summary?.trim()
  if (summary) bits.push(`In the style of: ${summary}`)
  const palette = (parts.palette ?? []).map(h => h.trim()).filter(Boolean)
  if (palette.length) bits.push(`palette: ${palette.join(', ')}`)
  const avoids = (parts.avoids ?? []).map(a => a.trim()).filter(Boolean)
  if (avoids.length) bits.push(`avoid: ${avoids.join(', ')}`)
  return bits.join('. ')
}

/** Subject + style block. Falls back to the bare subject when the block is empty. */
export function tastedPrompt(subject: string, parts: TasteStyleParts): string {
  const s = subject.trim()
  const block = tasteStyleBlock(parts)
  return block ? `${s}. ${block}` : s
}

/**
 * Moodboard reading → the spec style block (moodboard spec 2026-08-06):
 * `In the style of: <summary>. Palette: <Name #HEX, …>. Avoid: <a, b>.`
 * Named palette (curated {name, hex}) rather than the wall's bare hexes.
 * Empty parts are omitted entirely — no dangling `Palette:`/`Avoid:` labels.
 */
export function moodboardStyleBlock(reading: { summary: string; palette: { name: string; hex: string }[]; avoids: string[] }): string {
  const parts: string[] = []
  const summary = reading.summary.trim().replace(/\.?$/, '.')
  if (reading.summary.trim()) parts.push(`In the style of: ${summary}`)
  if (reading.palette.length) parts.push(`Palette: ${reading.palette.map(p => `${p.name} ${p.hex}`).join(', ')}.`)
  if (reading.avoids.length) parts.push(`Avoid: ${reading.avoids.join(', ')}.`)
  return parts.join(' ')
}
