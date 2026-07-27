// Elapsed-time formatting shared by the run status bar and the node capsule
// read-out. Extracted verbatim from CanvasStatusBar.vue so both surfaces
// describe time identically — a capsule reading "1m 12s" while the status bar
// reads "72s" for the same run is the kind of drift that erodes trust in both.

/** Format a duration in seconds: "8.4s" / "42s" / "1m 12s". */
export function fmtSec(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s - m * 60)
  return `${m}m ${rest}s`
}

/** Seconds between a start stamp and now. Zero when unstarted or if the clock
 *  moved backwards (system sleep, NTP correction). */
export function elapsedSince(startedAt: number | null | undefined, now: number): number {
  if (!startedAt) return 0
  return Math.max(0, (now - startedAt) / 1000)
}
