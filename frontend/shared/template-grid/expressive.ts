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

export function gridExpressiveLayout(opts: {
  content: string
  fontSize: number      // px
  boxWidth: number      // px (the element's resolved rect width)
  lineHeight: number    // multiplier
  params: ExpressiveParams
}): ExpressiveLayout {
  return layoutExpressive({
    text: opts.content,
    boxWidth: opts.boxWidth,
    lineHeight: opts.fontSize * opts.lineHeight,
    measure: (word) => word.length * opts.fontSize * CHAR_W,
    params: opts.params,
  })
}

/** Vertical block offset within the box for a given valign (block height =
 *  `layoutHeight`). Keeps expressive text honouring the element's valign. */
export function expressiveVOffset(boxHeight: number, layoutHeight: number, valign: 'top' | 'middle' | 'bottom'): number {
  const gap = Math.max(0, boxHeight - layoutHeight)
  return valign === 'middle' ? gap / 2 : valign === 'bottom' ? gap : 0
}
