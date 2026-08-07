/**
 * The atomic unit the Expressive/ring layout arranges. A tile is a glyph, a whole
 * word, or an image — the arrangement never learns which. `expandContent` is the
 * pure `content → tiles` seam; texture realization happens in the ring effect
 * (canvas-dependent, so it stays out of this pure module for unit-testability).
 */

export type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'image'; src: string; aspect?: number }

export type ExpandedTile =
  | { kind: 'image'; sourceId: string; src: string; aspect: number }
  | { kind: 'word'; sourceId: string; text: string }
  | { kind: 'letter'; sourceId: string; text: string; letterIndex: number }

/** Ordered content list → ordered tile sequence. Pure; no canvas, no three.js. */
export function expandContent(items: ContentItem[]): ExpandedTile[] {
  const out: ExpandedTile[] = []
  for (const item of items) {
    if (item.kind === 'image') {
      out.push({ kind: 'image', sourceId: item.id, src: item.src, aspect: item.aspect ?? 1 })
      continue
    }
    const text = String(item.text ?? '')
    if (item.resolution === 'whole') {
      if (text.trim().length > 0) out.push({ kind: 'word', sourceId: item.id, text })
      continue
    }
    // letters: one tile per non-space character, indexed among non-space chars
    let idx = 0
    for (const ch of text) {
      if (ch.trim().length === 0) continue
      out.push({ kind: 'letter', sourceId: item.id, text, letterIndex: idx })
      idx++
    }
  }
  return out
}

/** Parse the `content` JSON param safely; any malformed value → empty list. */
export function parseContent(json: string): ContentItem[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return v.filter(x => x && typeof x === 'object' && (x.kind === 'word' || x.kind === 'image'))
  } catch {
    return []
  }
}
