// Timeline→source frame mapping — the formulas pinned in types.ts (BaseClip
// speed/reverse doc comments). Phase 2 adds the Python twin; until then this
// is exercised by the engine playback specs against the frame-indexed video.
export interface SourceFrameClip {
  in_frame?: number
  length: number
  speed?: number
  reverse?: boolean
}

export function sourceFrameAt(clip: SourceFrameClip, localFrame: number): number {
  const speed = clip.speed ?? 1
  const inFrame = clip.in_frame ?? 0
  const eff = clip.reverse
    ? Math.max(0, Math.max(1, clip.length) - 1 - localFrame)
    : localFrame
  return inFrame + Math.floor(Math.max(0, eff) * speed)
}
