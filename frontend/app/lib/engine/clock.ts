// Playback position clock. While playing, position derives from a timebase
// chosen AT play(): the audio clock when available (AudioContext.currentTime —
// the only clock that never drifts from what you hear; video chases it), else
// the fallback (performance.now()/1000). The timebase is held until pause —
// switching mid-play would break the anchor. Paused/scrubbing: a settable
// position. No events; consumers sample now() inside rAF.

export interface ClockTimebases {
  /** Monotonic seconds. Default: performance.now()/1000. */
  fallback?: () => number
  /** Audio clock seconds, or null when the audio context isn't running. */
  audio?: () => number | null
}

export class PlaybackClock {
  private position = 0
  private anchor = 0
  private timebase: (() => number) | null = null
  private readonly bases: Required<Pick<ClockTimebases, 'fallback'>> & ClockTimebases

  constructor(bases: ClockTimebases = {}) {
    this.bases = { fallback: () => performance.now() / 1000, ...bases }
  }

  get playing(): boolean {
    return this.timebase !== null
  }

  now(): number {
    if (!this.timebase) return this.position
    return this.timebase() - this.anchor
  }

  play(): void {
    if (this.timebase) return
    const audioNow = this.bases.audio?.() ?? null
    this.timebase = audioNow !== null ? () => this.bases.audio!()! : this.bases.fallback
    this.anchor = this.timebase() - this.position
  }

  pause(): void {
    if (!this.timebase) return
    this.position = this.now()
    this.timebase = null
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds)
    if (this.timebase) this.anchor = this.timebase() - this.position
  }
}
