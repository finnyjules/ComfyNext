// frontend/app/lib/compositor/loopReconcile.ts
// Combine per-studio loop lengths into one Frame master loop where every slot
// completes whole cycles (LCM in a shared frame base) → seamless. Pure, no Vue/DOM.

/** A studio's true seamless length: base loop duration × the whole-cycle multiplier. */
export function effectiveLoopSeconds(loopDuration: number, k: number): number {
  return Math.max(0, loopDuration) * Math.max(1, k)
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b))
  while (b) { const t = b; b = a % b; a = t }
  return a || 1
}
function lcm(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b))
  if (a === 0 || b === 0) return Math.max(a, b)
  return (a / gcd(a, b)) * b
}

export interface ReconciledLoop { duration: number; fps: number; capped: boolean }

/**
 * Reconcile animated slot loops into one master loop. `slots` are the animated
 * wired studios (seconds > 0). Result loops at the LCM of the slot periods so each
 * completes whole cycles; clamped to `capSeconds` (falling back to whole multiples
 * of the longest slot so the dominant motion stays seamless).
 */
export function reconcileLoops(
  slots: { seconds: number; fps: number }[], capSeconds = 60,
): ReconciledLoop {
  const live = slots.filter(s => s.seconds > 0)
  if (!live.length) return { duration: 0, fps: 1, capped: false }
  const fps = Math.max(1, ...live.map(s => Math.max(1, Math.round(s.fps))))
  const frames = live.map(s => Math.max(1, Math.round(fps * s.seconds)))
  let combined = frames.reduce((acc, f) => lcm(acc, f), 1)
  let capped = false
  const capFrames = Math.max(1, Math.round(fps * capSeconds))
  if (combined > capFrames) {
    const longest = Math.max(...frames)
    combined = longest * Math.max(1, Math.floor(capFrames / longest))
    capped = true
  }
  return { duration: combined / fps, fps, capped }
}
