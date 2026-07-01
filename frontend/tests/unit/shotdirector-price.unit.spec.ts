import { describe, expect, it } from 'vitest'
import { estimateShotUSD, formatShotUSD } from '~/lib/shotdirector/price'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

describe('estimateShotUSD', () => {
  it('prices 720p by duration', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    expect(estimateShotUSD(sheet)).toBeCloseTo(0.90)
  })

  it('prices 1080p higher', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '1080p'
    sheet.format.durationS = 5
    expect(estimateShotUSD(sheet)).toBeCloseTo(2.25)
  })

  it('applies the video-reference uplift', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    sheet.references.push({ kind: 'video', slot: 1, src: 'data:video/mp4;base64,x', role: 'motion-transfer' })
    expect(estimateShotUSD(sheet)).toBeCloseTo(1.10)
  })

  it('formats with a tilde and two decimals', () => {
    const sheet = createDefaultShotSheet()
    sheet.format.resolution = '720p'
    sheet.format.durationS = 5
    expect(formatShotUSD(sheet)).toBe('~$0.90')
  })
})
