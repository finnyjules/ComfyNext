// frontend/app/lib/compositor/masterClock.ts
// The Frame owns one master timeline. It cannot defer to any single upstream (up to
// 16 slots), so it derives its clock from the longest animated slot (max fps),
// unless a manual override is set. Animated slots play at native speed and loop
// within the master timeline (slotPhase01); still slots (duration <= 0) are constant.

export interface SlotClock { duration: number; fps: number }
export type MasterClock = { duration: number; fps: number } | null

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
  return {
    duration: Math.max(...animated.map(s => s.duration)),
    fps: Math.max(...animated.map(s => s.fps)),
  }
}

/** Native-speed loop phase in [0,1): where this slot is at `masterTimeSec`. */
export function slotPhase01(masterTimeSec: number, slotDuration: number): number {
  if (slotDuration <= 0) return 0
  const t = ((masterTimeSec % slotDuration) + slotDuration) % slotDuration
  return t / slotDuration
}
