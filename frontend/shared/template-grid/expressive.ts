/** Smart Layout adapter for the expressive text engine.
 *
 * Uses the CHAR_W estimate (word.length × fontSize × CHAR_W) as the measure —
 * the SAME basis the fit/wrap estimate uses — so the editor DOM and the Satori
 * export position words identically. Consistency across the two surfaces matters
 * more than per-glyph accuracy (a deliberately-random layout tolerates drift),
 * which is exactly the philosophy in `./text`.
 */

import { CHAR_W } from './text'
import { layoutExpressive, type ExpressiveLayout, type ExpressiveParams } from '../text-layout/expressive'
import type { GridExpressiveParams, WordNudge } from './types'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function gridExpressiveLayout(opts: {
  content: string
  fontSize: number      // px
  boxWidth: number      // px (the element's resolved rect width)
  boxHeight?: number    // px (the element's resolved rect height) — for vertical justify
  lineHeight: number    // multiplier
  params: GridExpressiveParams
  justifyX?: boolean
  justifyY?: boolean
}): ExpressiveLayout {
  const lay = layoutExpressive({
    text: opts.content,
    boxWidth: opts.boxWidth,
    boxHeight: opts.boxHeight,
    lineHeight: opts.fontSize * opts.lineHeight,
    measure: (word) => word.length * opts.fontSize * CHAR_W,
    params: opts.params,
    justifyX: opts.justifyX,
    justifyY: opts.justifyY,
  })
  return applyWordNudges(lay, opts)
}

/** Apply manual per-word nudges (box-fraction dx/dy) on top of the engine
 *  layout, clamped so a word can touch but never escape the element box.
 *  Out-of-range indices and non-finite values are ignored. */
function applyWordNudges(
  lay: ExpressiveLayout,
  opts: { boxWidth: number; boxHeight?: number; fontSize: number; lineHeight: number; params: GridExpressiveParams },
): ExpressiveLayout {
  const nudges = opts.params.nudges
  if (!nudges || typeof nudges !== 'object') return lay
  const boxH = opts.boxHeight ?? lay.height
  const lineBand = opts.fontSize * opts.lineHeight
  const words = lay.words.map((w, i) => {
    const n = (nudges as Record<number, WordNudge>)[i]
    if (!n) return w
    const dx = Number.isFinite(n.dx) ? n.dx : 0
    const dy = Number.isFinite(n.dy) ? n.dy : 0
    if (!dx && !dy) return w
    return {
      ...w,
      x: clamp(w.x + dx * opts.boxWidth, 0, Math.max(0, opts.boxWidth - w.w)),
      y: clamp(w.y + dy * boxH, 0, Math.max(0, boxH - lineBand)),
    }
  })
  return { ...lay, words }
}

const ENGINE_KEYS: (keyof ExpressiveParams)[] = ['wordsPerLine', 'placement', 'jitterX', 'jitterY', 'seed']

/** Merge an inspector patch into the current expressive params. Any engine
 *  param change (Shuffle, placement, words-per-line, jitter) rearranges the
 *  anchors manual nudges were relative to, so those patches drop `nudges` —
 *  "re-roll means start over". Content and cosmetic edits never route here. */
export function mergeExpressivePatch(
  current: GridExpressiveParams,
  patch: Partial<GridExpressiveParams>,
): GridExpressiveParams {
  const merged: GridExpressiveParams = { ...current, ...patch }
  if (ENGINE_KEYS.some(k => k in patch)) delete merged.nudges
  return merged
}

/** Vertical block offset within the box for a given valign (block height =
 *  `layoutHeight`). Keeps expressive text honouring the element's valign. */
export function expressiveVOffset(boxHeight: number, layoutHeight: number, valign: 'top' | 'middle' | 'bottom'): number {
  const gap = Math.max(0, boxHeight - layoutHeight)
  return valign === 'middle' ? gap / 2 : valign === 'bottom' ? gap : 0
}
