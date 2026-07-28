/**
 * Normalized loop position from elapsed wall-clock time.
 *
 * Wall clock rather than a frame counter: an embed has no fps, only a refresh
 * rate, so 60Hz and 120Hz displays must show the same motion at the same moment.
 * Wraps to [0, 1) so t=duration is the loop's start, not its end — a seam-free
 * loop depends on never emitting exactly 1.
 */
export function t01At(elapsedMs: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  const durMs = durationSec * 1000
  const wrapped = elapsedMs % durMs
  return (wrapped < 0 ? wrapped + durMs : wrapped) / durMs
}
