/** Type scale resolution and estimate-based copy fitting. The estimate uses
 * an average glyph width (CHAR_W × fontSize) — deterministic and identical in
 * the editor and the renderer, which matters more than per-glyph accuracy.
 * Satori re-wraps at render time; fitting only decides size and truncation. */

import { CLASS_DEFAULTS, FONT_FLOOR, classifyFormat, metricScale } from './grid'
import type { TemplateV2, TextLevel, TextOverflow } from './types'

export const LEVELS: TextLevel[] = ['caption', 'body', 'subhead', 'headline', 'display']
export const CHAR_W = 0.55

/** Level-derived size for a format. `basePxOverride` (master px, from
 * style.fontSize) replaces the modular-scale base but keeps the per-format
 * scaling, so manual sizes still reflow across formats. */
export function typeSize(
  level: TextLevel, template: TemplateV2, formatKey: string,
  basePxOverride?: number,
): number {
  const f = template.formats[formatKey]
  if (!f) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const base = basePxOverride ?? (template.typeScale.base * template.typeScale.ratio ** LEVELS.indexOf(level))
  const raw = base
    * metricScale(template, f)
    * CLASS_DEFAULTS[classifyFormat(f)].typeMultiplier
  return Math.max(FONT_FLOOR, Math.round(raw))
}

export function wrapLines(text: string, fontSize: number, width: number): string[] {
  const cpl = Math.max(1, Math.floor(width / (fontSize * CHAR_W)))
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > cpl) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(w.slice(0, cpl))
      w = w.slice(cpl)
    }
    if (!w) continue
    const cand = cur ? `${cur} ${w}` : w
    if (cand.length <= cpl) cur = cand
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines
}

export interface FitResult {
  fontSize: number
  content: string     // possibly truncated (overflow: shrink-then-truncate)
  lines: string[]     // wrap estimate; rendering re-wraps
  clipped: boolean    // floor size still overflows and policy allows clipping
}

export function fitText(opts: {
  content: string
  maxFontSize: number
  w: number
  h: number
  lineHeight: number
  overflow: TextOverflow
  maxLines?: number
  /** Auto-shrink the size down to fit the region (default true). When false —
   *  the user set an explicit fontSize — the size is honoured exactly and the
   *  overflow policy handles the doesn't-fit case (truncate / clip). */
  autoShrink?: boolean
}): FitResult {
  const { content, lineHeight } = opts
  const maxLines = opts.maxLines ?? Number.POSITIVE_INFINITY
  const autoShrink = opts.autoShrink !== false
  const tryFit = (fs: number): string[] | null => {
    const lines = wrapLines(content, fs, opts.w)
    const ok = lines.length <= maxLines && lines.length * fs * lineHeight <= opts.h
    return ok ? lines : null
  }

  // Truncate `content` to the lines that fit `h` at `fs`, with an ellipsis.
  const truncateAt = (fs: number): FitResult => {
    const full = wrapLines(content, fs, opts.w)
    const byHeight = Math.floor(opts.h / (fs * lineHeight))
    const keep = Math.max(1, Math.min(Number.isFinite(maxLines) ? maxLines : byHeight, byHeight))
    const kept = full.slice(0, keep)
    const last = kept[kept.length - 1] ?? ''
    kept[kept.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`
    return { fontSize: fs, content: kept.join(' '), lines: kept, clipped: false }
  }

  const startFs = Math.max(FONT_FLOOR, Math.round(opts.maxFontSize))

  // Explicit size: keep it; only handle overflow.
  if (!autoShrink) {
    const lines = tryFit(startFs)
    if (lines) return { fontSize: startFs, content, lines, clipped: false }
    if (opts.overflow === 'shrink-then-truncate') return truncateAt(startFs)
    // 'shrink' (now "keep size, clip") or 'grow' with rows exhausted → clip.
    return { fontSize: startFs, content, lines: wrapLines(content, startFs, opts.w), clipped: true }
  }

  // Auto (level-derived) size: shrink toward the floor until it fits.
  let fs = startFs
  for (;;) {
    const lines = tryFit(fs)
    if (lines) return { fontSize: fs, content, lines, clipped: false }
    if (fs === FONT_FLOOR) break
    fs = Math.max(FONT_FLOOR, Math.floor(fs * 0.9))
  }

  if (opts.overflow !== 'shrink-then-truncate') {
    // 'shrink' clips; 'grow' only reaches here when the grid ran out of rows.
    return { fontSize: FONT_FLOOR, content, lines: wrapLines(content, FONT_FLOOR, opts.w), clipped: true }
  }
  return truncateAt(FONT_FLOOR)
}
