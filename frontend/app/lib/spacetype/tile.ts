/**
 * The atomic unit the Expressive/ring layout arranges. A tile is a glyph, a whole
 * word, or a card (image or a generated fill — solid/gradient/ombre/grid/noise) —
 * the arrangement never learns which. `expandContent` is the pure `content → tiles`
 * seam; texture realization happens in the ring effect (canvas-dependent, so it
 * stays out of this pure module for unit-testability).
 *
 * `Fill` is imported type-only: at runtime this module never touches three.js or
 * the fill-rendering code, it just carries the parsed `fill` object through.
 */

import type { Fill } from '~/lib/spacetype/fills'

export type CardFillKind = 'image' | 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise'

export type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'card'; fillKind: CardFillKind; src?: string; aspect?: number; fill?: Fill }

export type ExpandedTile =
  | { kind: 'card'; sourceId: string; fillKind: CardFillKind; src?: string; aspect: number; fill?: Fill }
  | { kind: 'word'; sourceId: string; text: string }
  | { kind: 'letter'; sourceId: string; text: string; letterIndex: number }

/** Ordered content list → ordered tile sequence. Pure; no canvas, no three.js. */
export function expandContent(items: ContentItem[]): ExpandedTile[] {
  const out: ExpandedTile[] = []
  for (const item of items) {
    if (item.kind === 'card') {
      out.push({
        kind: 'card',
        sourceId: item.id,
        fillKind: item.fillKind,
        src: item.src,
        aspect: item.aspect ?? 1,
        fill: item.fill,
      })
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

/** Parse the `content` JSON param safely; any malformed value → empty list.
 *  Migrates the legacy `kind:'image'` shape to `kind:'card', fillKind:'image'`,
 *  and defaults a `card` with no `fillKind` to `'image'` (has `src`) or `'solid'`. */
export function parseContent(json: string): ContentItem[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    const out: ContentItem[] = []
    for (const x of v) {
      if (!x || typeof x !== 'object') continue
      if (x.kind === 'word') {
        out.push(x)
        continue
      }
      if (x.kind === 'image') {
        out.push({ id: x.id, kind: 'card', fillKind: 'image', src: x.src, aspect: x.aspect })
        continue
      }
      if (x.kind === 'card') {
        const fillKind: CardFillKind = x.fillKind ?? (x.src ? 'image' : 'solid')
        out.push({ id: x.id, kind: 'card', fillKind, src: x.src, aspect: x.aspect, fill: x.fill })
        continue
      }
    }
    return out
  } catch {
    return []
  }
}
