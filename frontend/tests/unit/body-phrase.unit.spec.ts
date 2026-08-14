import { describe, expect, it } from 'vitest'
import { bodyPhrase } from '~/lib/characters/bodyPhrase'

describe('bodyPhrase — empty/neutral', () => {
  it('null → empty string', () => { expect(bodyPhrase(null)).toBe('') })
  it('undefined → empty string', () => { expect(bodyPhrase(undefined)).toBe('') })
  it('empty object → empty string', () => { expect(bodyPhrase({})).toBe('') })
  it('all sliders at 0.5 (neutral) → empty string', () => {
    expect(bodyPhrase({
      frame: 0.5, height: 0.5, build: 0.5, muscle: 0.5,
      shoulders: 0.5, chest: 0.5, waist: 0.5, hips: 0.5,
    })).toBe('')
  })
  it('dead zone is 0.5 ± 0.1 inclusive — 0.4 and 0.6 both emit nothing', () => {
    expect(bodyPhrase({ shoulders: 0.4 })).toBe('')
    expect(bodyPhrase({ shoulders: 0.6 })).toBe('')
  })
})

describe('bodyPhrase — worked example from the brief', () => {
  it('{build: 1, height: 0.1} orders height before build (BODY_SLIDERS order)', () => {
    expect(bodyPhrase({ build: 1, height: 0.1 }))
      .toBe('very short in stature, a very heavy, plus-size build with a full figure')
  })
})

describe('bodyPhrase — build band boundaries (< strict / > strict)', () => {
  it('< 0.15 → very slim, slight; exactly 0.15 falls to the next band', () => {
    expect(bodyPhrase({ build: 0.14 })).toBe('a very slim, slight build')
    expect(bodyPhrase({ build: 0.15 })).toBe('a slim build')
  })
  it('< 0.4 → slim; exactly 0.4 is the dead zone', () => {
    expect(bodyPhrase({ build: 0.39 })).toBe('a slim build')
    expect(bodyPhrase({ build: 0.4 })).toBe('')
  })
  it('> 0.6 → noticeably heavyset; exactly 0.6 is the dead zone', () => {
    expect(bodyPhrase({ build: 0.6 })).toBe('')
    expect(bodyPhrase({ build: 0.61 })).toBe('a noticeably heavyset build')
  })
  it('> 0.85 → very heavy, plus-size; exactly 0.85 falls to the previous band', () => {
    expect(bodyPhrase({ build: 0.85 })).toBe('a noticeably heavyset build')
    expect(bodyPhrase({ build: 0.86 })).toBe('a very heavy, plus-size build with a full figure')
  })
})

describe('bodyPhrase — height band boundaries', () => {
  it('< 0.15 → very short in stature; exactly 0.15 falls through', () => {
    expect(bodyPhrase({ height: 0.14 })).toBe('very short in stature')
    expect(bodyPhrase({ height: 0.15 })).toBe('short in stature')
  })
  it('< 0.4 → short in stature; exactly 0.4 is the dead zone', () => {
    expect(bodyPhrase({ height: 0.39 })).toBe('short in stature')
    expect(bodyPhrase({ height: 0.4 })).toBe('')
  })
  it('> 0.6 → tall; exactly 0.6 is the dead zone', () => {
    expect(bodyPhrase({ height: 0.6 })).toBe('')
    expect(bodyPhrase({ height: 0.61 })).toBe('tall')
  })
  it('> 0.85 → very tall; exactly 0.85 falls to the previous band', () => {
    expect(bodyPhrase({ height: 0.85 })).toBe('tall')
    expect(bodyPhrase({ height: 0.86 })).toBe('very tall')
  })
})

describe('bodyPhrase — muscle band boundaries (3 bands, no [0.15,0.4) band)', () => {
  it('< 0.15 → soft, undefined; exactly 0.15 emits nothing (no band covers it)', () => {
    expect(bodyPhrase({ muscle: 0.14 })).toBe('a soft, undefined physique')
    expect(bodyPhrase({ muscle: 0.15 })).toBe('')
  })
  it('[0.15, 0.4) has no band — emits nothing', () => {
    expect(bodyPhrase({ muscle: 0.39 })).toBe('')
  })
  it('> 0.6 → athletic, toned; exactly 0.6 is the dead zone', () => {
    expect(bodyPhrase({ muscle: 0.6 })).toBe('')
    expect(bodyPhrase({ muscle: 0.61 })).toBe('an athletic, toned physique')
  })
  it('> 0.85 → strongly muscular; exactly 0.85 falls to the previous band', () => {
    expect(bodyPhrase({ muscle: 0.85 })).toBe('an athletic, toned physique')
    expect(bodyPhrase({ muscle: 0.86 })).toBe('a strongly muscular physique')
  })
})

describe('bodyPhrase — two-band sliders (shoulders/chest/waist/hips/frame)', () => {
  it('shoulders: < 0.4 narrow, > 0.6 broad, boundaries are the dead zone', () => {
    expect(bodyPhrase({ shoulders: 0.39 })).toBe('narrow shoulders')
    expect(bodyPhrase({ shoulders: 0.4 })).toBe('')
    expect(bodyPhrase({ shoulders: 0.6 })).toBe('')
    expect(bodyPhrase({ shoulders: 0.61 })).toBe('broad shoulders')
  })
  it('chest: < 0.4 flat, > 0.6 full', () => {
    expect(bodyPhrase({ chest: 0.39 })).toBe('a flat chest')
    expect(bodyPhrase({ chest: 0.4 })).toBe('')
    expect(bodyPhrase({ chest: 0.6 })).toBe('')
    expect(bodyPhrase({ chest: 0.61 })).toBe('a full chest')
  })
  it('waist: < 0.4 narrow, > 0.6 thick', () => {
    expect(bodyPhrase({ waist: 0.39 })).toBe('a narrow waist')
    expect(bodyPhrase({ waist: 0.4 })).toBe('')
    expect(bodyPhrase({ waist: 0.6 })).toBe('')
    expect(bodyPhrase({ waist: 0.61 })).toBe('a thick waist')
  })
  it('hips: < 0.4 narrow, > 0.6 wide', () => {
    expect(bodyPhrase({ hips: 0.39 })).toBe('narrow hips')
    expect(bodyPhrase({ hips: 0.4 })).toBe('')
    expect(bodyPhrase({ hips: 0.6 })).toBe('')
    expect(bodyPhrase({ hips: 0.61 })).toBe('wide hips')
  })
  it('frame: < 0.4 feminine, > 0.6 masculine', () => {
    expect(bodyPhrase({ frame: 0.39 })).toBe('a feminine frame')
    expect(bodyPhrase({ frame: 0.4 })).toBe('')
    expect(bodyPhrase({ frame: 0.6 })).toBe('')
    expect(bodyPhrase({ frame: 0.61 })).toBe('a masculine frame')
  })
})

describe('bodyPhrase — fragment order and joining', () => {
  it('orders fragments by BODY_SLIDERS order regardless of key insertion order', () => {
    expect(bodyPhrase({ hips: 0.9, frame: 0.9, waist: 0.1 }))
      .toBe('a masculine frame, a narrow waist, wide hips')
  })
  it('joins with ", " and skips sliders that land in the dead zone', () => {
    expect(bodyPhrase({ frame: 0.5, height: 0.1, build: 0.5, muscle: 0.9, shoulders: 0.1, chest: 0.5, waist: 0.5, hips: 0.9 }))
      .toBe('very short in stature, a strongly muscular physique, narrow shoulders, wide hips')
  })
  it('a single fragment has no comma', () => {
    expect(bodyPhrase({ frame: 0.9 })).toBe('a masculine frame')
  })
  it('ignores unknown/non-numeric slider values', () => {
    expect(bodyPhrase({ frame: 0.9, notASlider: 0.9 } as any)).toBe('a masculine frame')
    expect(bodyPhrase({ frame: Number.NaN })).toBe('')
  })
})
