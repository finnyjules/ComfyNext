import { describe, it, expect } from 'vitest'
import { audioScheduleFor, gainAt } from '../../app/lib/engine/audio/audioEngine'

// Clip: start_frame 30, length 60 @ 30fps → timeline [1s, 3s); volume 0.8;
// audio_fade_in 15 frames (0.5s), audio_fade_out 30 frames (1s).
const clip = {
  start_frame: 30, length: 60, volume: 0.8,
  audio_fade_in: 15, audio_fade_out: 30, in_frame: 0,
}

describe('audioScheduleFor', () => {
  it('clip entirely ahead of the playhead: starts later, full duration', () => {
    const s = audioScheduleFor(clip, 0, 30)!
    expect(s.startInSec).toBeCloseTo(1, 10)
    expect(s.offsetSec).toBeCloseTo(0, 10)
    expect(s.durationSec).toBeCloseTo(2, 10)
    expect(s.gainPoints).toEqual([
      [0, 0], [0.5, 0.8],
      [1, 0.8], [2, 0],
    ])
  })

  it('playhead inside the clip: starts now, mid-asset offset, remaining duration', () => {
    const s = audioScheduleFor(clip, 2, 30)!
    expect(s.startInSec).toBe(0)
    expect(s.offsetSec).toBeCloseTo(1, 10)
    expect(s.durationSec).toBeCloseTo(1, 10)
  })

  it('clip already over: null', () => {
    expect(audioScheduleFor(clip, 5, 30)).toBeNull()
  })

  it('in_frame shifts the asset offset', () => {
    const s = audioScheduleFor({ ...clip, in_frame: 30 }, 2, 30)!
    expect(s.offsetSec).toBeCloseTo(2, 10)
  })

  it('no fades, default volume → flat envelope at 1', () => {
    const s = audioScheduleFor({ start_frame: 0, length: 30 }, 0, 30)!
    expect(s.gainPoints).toEqual([[0, 1], [1, 1]])
  })

  it('overlapping fades stay monotonic (fade-out clamped to fade-in end)', () => {
    // 1s clip, fade_in 0.8s, fade_out 0.8s → fade-out may not start at 0.2s
    // (before the fade-in ends); it clamps to 0.8s.
    const s = audioScheduleFor({ start_frame: 0, length: 30, audio_fade_in: 24, audio_fade_out: 24 }, 0, 30)!
    expect(s.gainPoints).toEqual([[0, 0], [0.8, 1], [0.8, 1], [1, 0]])
    const times = s.gainPoints.map(p => p[0])
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe('gainAt', () => {
  const pts: [number, number][] = [[0, 0], [0.5, 0.8], [1, 0.8], [2, 0]]
  it('interpolates linearly between anchors', () => {
    expect(gainAt(pts, 0.25)).toBeCloseTo(0.4, 10)
    expect(gainAt(pts, 0.75)).toBeCloseTo(0.8, 10)
    expect(gainAt(pts, 1.5)).toBeCloseTo(0.4, 10)
  })
  it('clamps outside the envelope', () => {
    expect(gainAt(pts, -1)).toBe(0)
    expect(gainAt(pts, 99)).toBe(0)
  })
})
