// Left-edge trim math. CapCut semantics: the left edge trims INTO the source
// (in_frame moves with the edge, content stays anchored on the timeline).
// `anchored` is true for source-backed kinds (video/audio); false for
// image/text/motion/workflow clips, whose in_frame is meaningless.

export interface TrimBase { start_frame: number; in_frame: number; length: number }

export function computeLeftTrim(base: TrimBase, rawNewStart: number, anchored: boolean): TrimBase {
  const end = base.start_frame + base.length
  // New start is bounded by: ≥ 0, ≤ end − 1 (min length 1), and for anchored
  // clips ≥ start − in_frame (can't rewind before the source's frame 0).
  let newStart = Math.max(0, Math.min(rawNewStart, end - 1))
  if (anchored) newStart = Math.max(newStart, base.start_frame - base.in_frame)
  const delta = newStart - base.start_frame
  return {
    start_frame: newStart,
    in_frame: anchored ? base.in_frame + delta : base.in_frame,
    length: base.length - delta,
  }
}

/** Cap a right-trim length at the source's remaining frames (null = unknown).
 *  `speed` converts the source budget into timeline frames: at 2× a clip
 *  consumes source twice as fast, so half as many timeline frames fit. */
export function clampLengthToSource(length: number, inFrame: number, sourceFrames: number | null, speed = 1): number {
  if (sourceFrames == null) return Math.max(1, length)
  const budget = Math.floor((sourceFrames - inFrame) / Math.max(0.1, speed))
  return Math.max(1, Math.min(length, budget))
}
