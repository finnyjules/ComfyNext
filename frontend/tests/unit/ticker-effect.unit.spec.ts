import { describe, it, expect } from 'vitest'
import { tickerEffect } from '~/lib/spacetype/effects/ticker'
import { getEffect, SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'
import { SPACE_TYPE_SECTIONS } from '~/lib/spacetype/sections'
import { defaultsFromControls } from '~/lib/spacetype/effect'

describe('ticker registration', () => {
  it('is registered and resolvable by id', () => {
    expect(getEffect('ticker').id).toBe('ticker')
    expect(SPACE_TYPE_EFFECTS).toContain(tickerEffect)
  })
  it('is not hidden', () => {
    expect(tickerEffect.hidden).toBeFalsy()
  })
  it('resolves case-insensitively', () => {
    expect(getEffect('Ticker').id).toBe('ticker')
  })
})

describe('ticker controls', () => {
  it('only uses groups the panel can render', () => {
    for (const c of tickerEffect.controls) {
      expect(SPACE_TYPE_SECTIONS).toContain(c.group)
    }
  })
  it('defaults to a flat face-on ticker', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    expect(d.waveAmplitude).toBe(0)
    expect(d.rotateX).toBe(0)
    expect(d.rowCount).toBe(3)
  })
  it('declares waveSpeed live but wave shape structural', () => {
    expect(tickerEffect.liveKeys).toContain('waveSpeed')
    expect(tickerEffect.liveKeys).not.toContain('waveAmplitude')
    expect(tickerEffect.liveKeys).not.toContain('waveFrequency')
  })
})

describe('ticker loopRates', () => {
  it('reports whole-cycle rates for the scroll', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    const rates = tickerEffect.loopRates!(d)
    expect(rates.length).toBeGreaterThan(0)
    for (const r of rates) expect(Number.isFinite(r)).toBe(true)
  })
  // The probe is 3, not 2: at the defaults the SCROLL rate is already
  // loopTiles(speed 0.6, uRepeat 4) = round(2.4) = 2, so a waveSpeed of 2 is
  // indistinguishable from the scroll rate and the "only when non-zero" half of
  // this assertion could never hold. 3 is outside the scroll rate's range here.
  it('includes the wave rate once waveSpeed is non-zero', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    const still = tickerEffect.loopRates!({ ...d, waveSpeed: 0 })
    const moving = tickerEffect.loopRates!({ ...d, waveSpeed: 3 })
    expect(moving).toContain(3)
    expect(still).not.toContain(3)
  })
})
