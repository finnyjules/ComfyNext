import { describe, it, expect } from 'vitest'
import { resolveTierDisplayStyle } from '~~/shared/template-grid/generate/tierDisplay'
import type { ElementV2 } from '~~/shared/template-grid/types'

/**
 * FIX 9 (round-2b final fix wave): TierTypePanel's shown values used to
 * source straight off the tier's OWN stored override (`t.fontFamily`, etc.)
 * with a hardcoded literal fallback ('Inter', 400, 0, blank) whenever the
 * tier hadn't set that field — even when the SELECTED element's actual
 * `.style` (staging voice default + tier override, tier winning) carried a
 * completely different real value, like lockup's Playfair Display voice
 * default. `resolveTierDisplayStyle` is the pure derivation the panel now
 * uses; these tests exercise it directly (no Vue mount needed).
 */

function textEl(style: Record<string, unknown>): ElementV2 {
  return { id: 'tier_hero_0', type: 'text', content: 'X', level: 'display', priority: 1,
    region: { col: 1, colSpan: 4, row: 1, rowSpan: 2 }, style } as unknown as ElementV2
}

describe('resolveTierDisplayStyle', () => {
  it('null/undefined selection falls back to the literal defaults', () => {
    expect(resolveTierDisplayStyle(null)).toEqual({ fontFamily: 'Inter', fontWeight: 400, letterSpacing: 0, color: '' })
    expect(resolveTierDisplayStyle(undefined)).toEqual({ fontFamily: 'Inter', fontWeight: 400, letterSpacing: 0, color: '' })
  })

  it('a non-text element (image/shape) falls back to the literal defaults', () => {
    const img: ElementV2 = { id: 'img_0', type: 'image', content: 'x', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 2 } }
    expect(resolveTierDisplayStyle(img)).toEqual({ fontFamily: 'Inter', fontWeight: 400, letterSpacing: 0, color: '' })
  })

  it('a text element with no style at all falls back to the literal defaults', () => {
    const el: ElementV2 = { id: 'tier_hero_0', type: 'text', content: 'X', level: 'display', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 2 } }
    expect(resolveTierDisplayStyle(el)).toEqual({ fontFamily: 'Inter', fontWeight: 400, letterSpacing: 0, color: '' })
  })

  // The actual bug this fix closes: a staging's VOICE DEFAULT (e.g. lockup's
  // Playfair Display, applied via `tierText`'s `opts.style` when the tier's
  // own `type` never overrode `fontFamily`) is what's REALLY rendering —
  // the panel must show that, not a generic "Inter" guess unrelated to it.
  it('reads the SELECTED element\'s real resolved style — a staging voice default, not a hardcoded guess', () => {
    const el = textEl({ fontFamily: 'Playfair Display', fontWeight: 700, letterSpacing: -2, color: '{{ brand.accent }}' })
    expect(resolveTierDisplayStyle(el)).toEqual({
      fontFamily: 'Playfair Display', fontWeight: 700, letterSpacing: -2, color: '{{ brand.accent }}',
    })
  })

  it('each field falls back independently to its own literal default when unset on an otherwise-styled element', () => {
    const el = textEl({ fontWeight: 700 })  // fontFamily/letterSpacing/color all unset
    expect(resolveTierDisplayStyle(el)).toEqual({ fontFamily: 'Inter', fontWeight: 700, letterSpacing: 0, color: '' })
  })

  it('fontWeight 0 is falsy but not a valid weight — falls back to 400 (matches the panel\'s <select> domain of 400|700)', () => {
    const el = textEl({ fontWeight: 0 })
    expect(resolveTierDisplayStyle(el).fontWeight).toBe(400)
  })
})
