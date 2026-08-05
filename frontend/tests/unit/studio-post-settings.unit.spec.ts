import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
import { DEFAULT_POST as LEGACY } from '~/lib/spacetype/postSettings'

describe('studio post settings', () => {
  it('exposes the defaults from the new home', () => {
    expect(DEFAULT_POST.bloom).toBe(false)
    expect(DEFAULT_POST.bloomStrength).toBe(0.6)
  })

  it('keeps the legacy import path working (a dozen importers rely on it)', () => {
    expect(LEGACY).toBe(DEFAULT_POST)
  })

  it('reports enabled only when an effect is on', () => {
    expect(postEnabled(DEFAULT_POST)).toBe(false)
    expect(postEnabled({ ...DEFAULT_POST, bloom: true })).toBe(true)
  })

  it('declares the three effects the union adds', () => {
    expect(DEFAULT_POST.grain).toBe(false)
    expect(DEFAULT_POST.grainAmount).toBe(0.25)
    expect(DEFAULT_POST.grainSize).toBe(2)
    expect(DEFAULT_POST.vignette).toBe(false)
    expect(DEFAULT_POST.duotone).toBe(false)
    expect(DEFAULT_POST.duotoneShadow).toBe('#1a1a2e')
    expect(DEFAULT_POST.duotoneHighlight).toBe('#f5f0e8')
  })

  // A doc with only a new effect on must not read as post-off, or the whole
  // chain is skipped and the effect silently does nothing.
  it('reports enabled for each new effect on its own', () => {
    for (const key of ['grain', 'vignette', 'duotone'] as const) {
      expect(postEnabled({ ...DEFAULT_POST, [key]: true })).toBe(true)
    }
  })
})
