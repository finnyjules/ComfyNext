import type { EditState } from '~~/shared/timeline/types'

// Web Audio playback for timeline audio clips. Pure scheduling math
// (audioScheduleFor — unit-tested) + a thin graph: one AudioBufferSourceNode +
// GainNode per overlapping clip per play(). Fade math mirrors the visual side:
// audio_fade_in ramps local 0→fi, audio_fade_out ramps (length-fo)→length.
// Muted tracks are skipped at load. stop() tears the graph down; pause/seek =
// stop + play(newPosition).

export interface AudioClipLike {
  start_frame: number
  length: number
  in_frame?: number
  volume?: number
  audio_fade_in?: number
  audio_fade_out?: number
}

export interface AudioSchedule {
  /** Seconds from "now" until the source starts (0 = already inside the clip). */
  startInSec: number
  /** Offset into the ASSET at which playback starts. */
  offsetSec: number
  durationSec: number
  /** Envelope as [clipRelativeSeconds, gain] anchor points (linear ramps). */
  gainPoints: [number, number][]
}

export function audioScheduleFor(clip: AudioClipLike, positionSec: number, fps: number): AudioSchedule | null {
  const startSec = clip.start_frame / fps
  const lengthSec = Math.max(1, clip.length) / fps
  const endSec = startSec + lengthSec
  if (positionSec >= endSec) return null

  const intoClip = Math.max(0, positionSec - startSec)
  const volume = clip.volume ?? 1
  const fiSec = (clip.audio_fade_in ?? 0) / fps
  const foSec = (clip.audio_fade_out ?? 0) / fps

  const gainPoints: [number, number][] = []
  if (fiSec > 0) gainPoints.push([0, 0], [fiSec, volume])
  else gainPoints.push([0, volume])
  if (foSec > 0) gainPoints.push([lengthSec - foSec, volume], [lengthSec, 0])
  else gainPoints.push([lengthSec, volume])

  return {
    startInSec: Math.max(0, startSec - positionSec),
    offsetSec: (clip.in_frame ?? 0) / fps + intoClip,
    durationSec: lengthSec - intoClip,
    gainPoints,
  }
}

/** Linear interpolation over the envelope anchors (exported for tests + play). */
export function gainAt(points: [number, number][], t: number): number {
  if (!points.length) return 1
  if (t <= points[0]![0]) return points[0]![1]
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, g0] = points[i]!
    const [t1, g1] = points[i + 1]!
    if (t >= t0 && t <= t1) {
      return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
    }
  }
  return points[points.length - 1]![1]
}

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()  // clip id → decoded asset
  private voices: Voice[] = []
  private fps = 30

  /** Decode every unmuted audio clip's asset. resolveUrl maps a clip's path to
   *  a fetchable URL (harness routes fixture media; the editor (M3) resolves
   *  via the asset library). */
  async load(state: EditState, resolveUrl: (path: string) => string): Promise<void> {
    this.disposeVoices()
    this.buffers.clear()
    this.fps = state.canvas.fps
    this.ctx ??= new AudioContext()

    const jobs: Promise<void>[] = []
    for (const track of state.tracks) {
      if (track.muted || track.kind !== 'audio') continue
      for (const clip of track.clips) {
        if (clip.kind !== 'audio' || !clip.path) continue
        const url = resolveUrl(clip.path)
        jobs.push(
          fetch(url)
            .then(r => {
              if (!r.ok) throw new Error(`audio fetch ${r.status}: ${url}`)
              return r.arrayBuffer()
            })
            .then(b => this.ctx!.decodeAudioData(b))
            .then(buf => { this.buffers.set(clip.id, buf) }),
        )
      }
    }
    await Promise.all(jobs)
  }

  /** AudioContext time in seconds, or null when not running (clock fallback). */
  timebase = (): number | null =>
    this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime : null

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
  }

  /** Schedule all clips overlapping [positionSec, …). Call stop() first when
   *  re-scheduling (seek). */
  play(state: EditState, positionSec: number): void {
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    for (const track of state.tracks) {
      if (track.muted || track.kind !== 'audio') continue
      for (const clip of track.clips) {
        if (clip.kind !== 'audio') continue
        const buf = this.buffers.get(clip.id)
        if (!buf) continue
        const s = audioScheduleFor(clip, positionSec, this.fps)
        if (!s) continue

        const src = this.ctx.createBufferSource()
        src.buffer = buf
        const gain = this.ctx.createGain()
        src.connect(gain).connect(this.ctx.destination)

        // The clip's timeline start expressed in AudioContext time. When the
        // playhead is already inside the clip this lies in the past; only
        // anchors after the source start become ramps.
        const startSec = clip.start_frame / this.fps
        const clipStartAbs = t0 + startSec - positionSec
        const sourceStartAbs = t0 + s.startInSec
        gain.gain.setValueAtTime(gainAt(s.gainPoints, Math.max(0, positionSec - startSec)), sourceStartAbs)
        for (const [t, g] of s.gainPoints) {
          const abs = clipStartAbs + t
          if (abs > sourceStartAbs) gain.gain.linearRampToValueAtTime(g, abs)
        }

        src.start(sourceStartAbs, s.offsetSec, s.durationSec)
        this.voices.push({ src, gain })
      }
    }
  }

  stop(): void {
    this.disposeVoices()
  }

  private disposeVoices(): void {
    for (const v of this.voices) {
      try { v.src.stop() } catch {}
      v.src.disconnect()
      v.gain.disconnect()
    }
    this.voices = []
  }

  dispose(): void {
    this.disposeVoices()
    this.buffers.clear()
    this.ctx?.close()
    this.ctx = null
  }
}
