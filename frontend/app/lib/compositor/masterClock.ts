// frontend/app/lib/compositor/masterClock.ts
// The Frame owns one master timeline. It cannot defer to any single upstream (up to
// 16 slots), so it reconciles the animated slots' loop periods via LCM (capped at 60s,
// see reconcileLoops) into one seamless master loop, unless a manual override is set.
// Animated slots play at native speed and loop within the master timeline (slotPhase01);
// still slots (duration <= 0) are constant.

import { reconcileLoops } from './loopReconcile'

export interface SlotClock { duration: number; fps: number }
export type MasterClock = { duration: number; fps: number; capped?: boolean } | null

/**
 * Master clock from the animated slots. Override wins when present. Null when there
 * is nothing animated and no override — the Frame is static (no loop, one-frame bake),
 * exactly today's behaviour. The derived branch never needs a fallback constant
 * because it only runs when at least one animated slot exists.
 */
export function deriveMasterClock(
  slots: SlotClock[], override?: { duration: number; fps: number } | null,
): MasterClock {
  if (override) return { duration: override.duration, fps: override.fps }
  const animated = slots.filter(s => s.duration > 0)
  if (!animated.length) return null
  const r = reconcileLoops(animated.map(s => ({ seconds: s.duration, fps: s.fps })))
  // Only surface `capped` when true so unchanged results stay {duration,fps} (existing shape).
  return r.capped ? { duration: r.duration, fps: r.fps, capped: true } : { duration: r.duration, fps: r.fps }
}

/**
 * Quantized frame index for the LIVE PREVIEW at `fps` after `elapsedSec` of wall
 * clock. The Frame's rAF loop renders once per DISTINCT index — not once per display
 * repaint — so a 30fps scene isn't pull+composited 4× on a 120Hz (ProMotion) display.
 * Monotonic (no wrap): it only feeds a "did the frame change since last render?"
 * comparison, so a later time always yields a >= index. `fps` is floored to 1 so a
 * missing/zero fps degrades to 1fps rather than falling back to the refresh rate.
 */
export function masterFrameIndex(elapsedSec: number, fps: number): number {
  return Math.floor(elapsedSec * Math.max(1, fps))
}

/** Native-speed loop phase in [0,1): where this slot is at `masterTimeSec`. */
export function slotPhase01(masterTimeSec: number, slotDuration: number): number {
  if (slotDuration <= 0) return 0
  const t = ((masterTimeSec % slotDuration) + slotDuration) % slotDuration
  return t / slotDuration
}
