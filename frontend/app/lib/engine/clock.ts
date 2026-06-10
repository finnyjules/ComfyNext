// Playback position clock. While playing, position derives from a timebase
// chosen AT play(): the audio clock when available (AudioContext.currentTime —
// the only clock that never drifts from what you hear; video chases it), else
// the fallback (performance.now()/1000). The timebase is held until pause —
// switching mid-play would break the anchor. If the audio clock suspends
// mid-play (e.g. Safari tab-background, device switch), now() holds the last
// good position and re-anchors automatically when the clock returns.
// Paused/scrubbing: a settable position. No events; consumers sample now()
// inside rAF.

export interface ClockTimebases {
  /** Monotonic seconds. Default: performance.now()/1000. */
  fallback?: () => number
  /** Audio clock seconds, or null when the audio context isn't running. */
  audio?: () => number | null
}

export class PlaybackClock {
  private position = 0
  private anchor = 0
  private timebase: (() => number | null) | null = null
  private held = false
  private readonly bases: Required<Pick<ClockTimebases, 'fallback'>> & ClockTimebases

  constructor(bases: ClockTimebases = {}) {
    this.bases = { fallback: () => performance.now() / 1000, ...bases }
  }

  get playing(): boolean {
    return this.timebase !== null
  }

  now(): number {
    if (!this.timebase) return this.position
    const t = this.timebase()
    if (t === null) {
      // Audio clock gone mid-play (context suspended): hold the last position.
      this.held = true
      return this.position
    }
    if (this.held) {
      // Clock came back: re-anchor so playback resumes from the hold point
      // instead of jumping by the suspension duration.
      this.anchor = t - this.position
      this.held = false
    }
    this.position = t - this.anchor   // track last good position every sample
    return this.position
  }

  play(): void {
    if (this.timebase) return
    const audioNow = this.bases.audio?.() ?? null
    if (audioNow !== null) {
      this.timebase = this.bases.audio!   // keep null in the type — no !()! wrapper
      this.anchor = audioNow - this.position
    } else {
      this.timebase = this.bases.fallback
      this.anchor = this.bases.fallback() - this.position
    }
    this.held = false
  }

  pause(): void {
    if (!this.timebase) return
    this.position = this.now()
    this.timebase = null
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds)
    if (!this.timebase) return
    const t = this.timebase()
    if (t !== null) this.anchor = t - this.position
    else this.held = true   // anchor recomputed on the next non-null sample
  }
}
