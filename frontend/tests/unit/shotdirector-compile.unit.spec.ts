import { describe, it, expect } from 'vitest'
import { createDefaultShotSheet, type Ref } from '../../app/lib/shotdirector/types'
import { SEEDANCE_PROFILE } from '../../app/lib/shotdirector/profiles'
import { buildPrompt, countWords, compileShot } from '../../app/lib/shotdirector/compile'

function baseSheet() {
  const s = createDefaultShotSheet()
  s.subject = 'A jazz singer in a red dress'
  s.action = 'steps up to the microphone and begins to sing'
  s.environment = 'a dim, smoky 1950s jazz club'
  s.lighting = 'warm rim light from a single spotlight'
  s.style = 'grainy 16mm film'
  s.camera = { shotType: 'medium', move: 'push-in', pacing: 'slow' }
  s.constraints = ['jitter', 'bent limbs']
  return s
}

describe('countWords', () => {
  it('counts whitespace-separated tokens', () => {
    expect(countWords('  one   two three ')).toBe(3)
    expect(countWords('')).toBe(0)
  })
})

describe('buildPrompt — reference mode, no beats', () => {
  it('assembles canonical-order prose with bracketed reference tags', () => {
    const s = baseSheet()
    const img: Ref = { kind: 'image', slot: 1, src: 'x', role: 'identity-lock' }
    const vid: Ref = { kind: 'video', slot: 1, src: 'x', role: 'camera-copy' }
    s.references = [img, vid]
    s.audio.dialogue = [{ line: 'Good evening, everyone.' }]

    expect(buildPrompt(s, SEEDANCE_PROFILE)).toBe(
      'A jazz singer in a red dress steps up to the microphone and begins to sing, '
      + 'in a dim, smoky 1950s jazz club. '
      + 'Medium shot, slow dolly in, the camera moving physically forward. '
      + 'Warm rim light from a single spotlight; grainy 16mm film. '
      + "Use @Image1 for the character's identity and wardrobe; @Video1 for the camera movement. "
      + '"Good evening, everyone." '
      + 'Avoid jitter, bent limbs.',
    )
  })

  it('phrases a location-role image as the environment plate', () => {
    const s = baseSheet()
    const loc: Ref = { kind: 'image', slot: 1, src: 'plate', role: 'location' }
    s.references = [loc]
    expect(buildPrompt(s, SEEDANCE_PROFILE)).toContain('Use @Image1 for the location and setting.')
  })

  it('omits reference tags in first/last-frame mode', () => {
    const s = baseSheet()
    s.mode = 'firstLastFrame'
    s.firstFrame = 'FIRST'
    const prompt = buildPrompt(s, SEEDANCE_PROFILE)
    expect(prompt).not.toContain('@Image')
    expect(prompt).toContain('Medium shot, slow dolly in, the camera moving physically forward.')
  })
})

describe('buildPrompt — beats', () => {
  it('renders timed segments in place of the camera line', () => {
    const s = baseSheet()
    s.format.durationS = 8
    s.beats = [
      { id: 'b0', startS: 0, endS: 4, action: 'she walks to the bar', shotType: 'wide', move: 'locked-off', pacing: 'smooth' },
      { id: 'b1', startS: 4, endS: 8, action: 'she picks up a glass', shotType: 'close-up', move: 'push-in', pacing: 'slow' },
    ]
    const prompt = buildPrompt(s, SEEDANCE_PROFILE)
    expect(prompt).toContain('[0s] Wide shot, smooth locked-off, a static camera. She walks to the bar.')
    expect(prompt).toContain('[4s] Close-up, slow dolly in, the camera moving physically forward. She picks up a glass.')
    // The single non-beat camera line must NOT also appear.
    expect(prompt).not.toContain('Medium shot, slow dolly in')
  })
})

describe('compileShot', () => {
  it('returns prompt + input + word count with no issues for a valid sheet', () => {
    const s = baseSheet()
    s.references = [{ kind: 'image', slot: 1, src: 'img1', role: 'identity-lock' }]
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.issues).toEqual([])
    expect(r.wordCount).toBeGreaterThan(0)
    expect(r.input.prompt).toBe(r.prompt)
    expect(r.input.image_urls).toEqual(['img1'])
  })

  it('adds a warning when the prompt exceeds the word budget', () => {
    const s = baseSheet()
    s.action = 'sings ' + 'la '.repeat(120)
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.wordCount).toBeGreaterThan(100)
    expect(r.issues.some(i => i.level === 'warning' && i.code === 'word-budget-warning')).toBe(true)
  })

  it('adds a hard error when the prompt exceeds the hard word budget', () => {
    const s = baseSheet()
    s.action = 'sings ' + 'la '.repeat(700)
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.wordCount).toBeGreaterThan(600)
    expect(r.issues.some(i => i.level === 'error' && i.code === 'word-budget-exceeded')).toBe(true)
  })

  it('surfaces validation errors from the sheet', () => {
    const s = baseSheet()
    s.references = [{ kind: 'audio', slot: 1, src: 'a', role: 'mood' }]
    const r = compileShot(s, SEEDANCE_PROFILE)
    expect(r.issues.some(i => i.code === 'audio-needs-visual')).toBe(true)
  })
})
