import { describe, it, expect } from 'vitest'
import { PlaybackClock } from '../../app/lib/engine/clock'

function fakeTime() {
  let t = 100
  return { now: () => t, advance: (dt: number) => { t += dt } }
}

describe('PlaybackClock', () => {
  it('paused: position is settable and static', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    expect(clock.now()).toBe(0)
    clock.seek(2.5)
    ft.advance(10)
    expect(clock.now()).toBe(2.5)
    expect(clock.playing).toBe(false)
  })

  it('playing: position advances with the timebase', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    clock.seek(1)
    clock.play()
    ft.advance(0.5)
    expect(clock.now()).toBeCloseTo(1.5, 10)
    clock.pause()
    ft.advance(5)
    expect(clock.now()).toBeCloseTo(1.5, 10)
  })

  it('seek while playing re-anchors', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    clock.play()
    ft.advance(1)
    clock.seek(10)
    ft.advance(0.25)
    expect(clock.now()).toBeCloseTo(10.25, 10)
  })

  it('prefers the audio timebase when provided and running', () => {
    const ft = fakeTime()
    const at = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now, audio: () => at.now() })
    clock.play()
    at.advance(0.4)
    ft.advance(9.9) // fallback advancing differently must not matter
    expect(clock.now()).toBeCloseTo(0.4, 10)
  })

  it('falls back when the audio timebase reports null (context not running)', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now, audio: () => null })
    clock.play()
    ft.advance(0.3)
    expect(clock.now()).toBeCloseTo(0.3, 10)
  })
})
