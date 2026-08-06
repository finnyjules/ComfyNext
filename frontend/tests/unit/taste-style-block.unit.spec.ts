/**
 * tasteStyleBlock / tastedPrompt (app/lib/taste/styleBlock.ts) — the diffusion
 * generation row's prompt composition on /dev/taste-wall. Each part (summary,
 * palette, avoids) must actually appear (an implementation that drops one —
 * the broken control — fails here), and empty parts must vanish without
 * leaving dangling labels.
 */
import { describe, expect, it } from 'vitest'
import { tastedPrompt, tasteStyleBlock } from '~/lib/taste/styleBlock'

const FULL = {
  summary: 'sun-bleached pastel retro California',
  palette: ['#f4a7b9', '#7fd4d0', '#ffd9a0'],
  avoids: ['harsh contrast', 'neon saturation'],
}

describe('tasteStyleBlock', () => {
  it('composes summary + palette + avoids, each under its label', () => {
    const block = tasteStyleBlock(FULL)
    expect(block).toBe(
      'In the style of: sun-bleached pastel retro California. '
      + 'palette: #f4a7b9, #7fd4d0, #ffd9a0. '
      + 'avoid: harsh contrast, neon saturation',
    )
  })

  // The broken-control trio: a version that ignores any ONE part fails its test.
  it('includes the summary (a summary-ignoring version fails)', () => {
    expect(tasteStyleBlock(FULL)).toContain('In the style of: sun-bleached pastel retro California')
  })
  it('includes every palette hex (a palette-ignoring version fails)', () => {
    const block = tasteStyleBlock(FULL)
    for (const hex of FULL.palette) expect(block).toContain(hex)
  })
  it('includes the avoids (an avoids-ignoring version fails)', () => {
    expect(tasteStyleBlock(FULL)).toContain('avoid: harsh contrast, neon saturation')
  })

  it('omits empty parts without dangling labels', () => {
    expect(tasteStyleBlock({ summary: FULL.summary })).toBe('In the style of: sun-bleached pastel retro California')
    const noSummary = tasteStyleBlock({ palette: FULL.palette, avoids: FULL.avoids })
    expect(noSummary).toBe('palette: #f4a7b9, #7fd4d0, #ffd9a0. avoid: harsh contrast, neon saturation')
    expect(noSummary).not.toContain('In the style of')
    const noAvoids = tasteStyleBlock({ summary: FULL.summary, palette: FULL.palette, avoids: [] })
    expect(noAvoids).not.toContain('avoid')
  })

  it('treats whitespace-only and empty entries as absent', () => {
    expect(tasteStyleBlock({ summary: '  ', palette: ['', '  '], avoids: [' '] })).toBe('')
    expect(tasteStyleBlock({})).toBe('')
    // undefined/null containers too
    expect(tasteStyleBlock({ summary: null, palette: null, avoids: null })).toBe('')
  })
})

describe('tastedPrompt', () => {
  it('appends the block to the subject with a sentence break', () => {
    expect(tastedPrompt('a small lighthouse on a rocky coast, morning', { summary: 'foggy minimalism' }))
      .toBe('a small lighthouse on a rocky coast, morning. In the style of: foggy minimalism')
  })
  it('returns the bare trimmed subject when the block is empty', () => {
    expect(tastedPrompt('  a lighthouse  ', {})).toBe('a lighthouse')
  })
})
