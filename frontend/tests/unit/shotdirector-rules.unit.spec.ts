import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type ShotSheet, type Ref } from '../../app/lib/shotdirector/types'
import { validateShotSheet, type RefCaps } from '../../app/lib/shotdirector/rules'

const CAPS: RefCaps = { maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3, supportsFirstLastFrame: true }

const img = (slot: number): Ref => ({ kind: 'image', slot, src: 'x', role: 'identity-lock' })
const aud = (slot: number): Ref => ({ kind: 'audio', slot, src: 'x', role: 'mood' })

function codes(sheet: ShotSheet) {
  return validateShotSheet(sheet, CAPS).map(i => i.code)
}

describe('validateShotSheet', () => {
  it('a fresh default sheet has no issues', () => {
    expect(validateShotSheet(createDefaultShotSheet(), CAPS)).toEqual([])
  })

  it('flags reference mode carrying a first frame', () => {
    const s = createDefaultShotSheet()
    s.firstFrame = 'data:...'
    expect(codes(s)).toContain('mode-conflict')
  })

  it('flags firstLastFrame mode carrying references', () => {
    const s = createDefaultShotSheet()
    s.mode = 'firstLastFrame'
    s.references = [img(1)]
    expect(codes(s)).toContain('mode-conflict')
  })

  it('flags audio references with no visual reference', () => {
    const s = createDefaultShotSheet()
    s.references = [aud(1)]
    expect(codes(s)).toContain('audio-needs-visual')
  })

  it('allows audio references when an image reference is present', () => {
    const s = createDefaultShotSheet()
    s.references = [img(1), aud(1)]
    expect(codes(s)).not.toContain('audio-needs-visual')
  })

  it('flags more than three beats', () => {
    const s = createDefaultShotSheet()
    s.beats = [0, 1, 2, 3].map(i => ({ id: `b${i}`, startS: i, endS: i + 1, action: 'x' }))
    expect(codes(s)).toContain('too-many-beats')
  })

  it('flags beats when duration is intelligent (-1)', () => {
    const s = createDefaultShotSheet()
    s.format.durationS = -1
    s.beats = [{ id: 'b0', startS: 0, endS: 2, action: 'x' }]
    expect(codes(s)).toContain('beats-need-duration')
  })

  it('flags a beat that overflows the clip duration', () => {
    const s = createDefaultShotSheet()
    s.format.durationS = 5
    s.beats = [{ id: 'b0', startS: 0, endS: 8, action: 'x' }]
    expect(codes(s)).toContain('beat-overflow')
  })

  it('flags too many image references for the profile', () => {
    const s = createDefaultShotSheet()
    s.references = Array.from({ length: 10 }, (_, i) => img(i + 1))
    expect(codes(s)).toContain('too-many-image-refs')
  })

  it('flags video references when the profile supports none', () => {
    const s = createDefaultShotSheet()
    s.references = [img(1), { kind: 'video', slot: 1, src: 'x', role: 'camera-copy' }]
    const caps: RefCaps = { ...CAPS, maxRefVideos: 0 }
    expect(validateShotSheet(s, caps).map(i => i.code)).toContain('videos-unsupported')
  })
})
