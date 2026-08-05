import { KEY_COARSE_STEPS } from './row'

export interface ScrubArgs {
  startValue: number
  deltaPx: number
  min: number
  max: number
  step: number
  scrubPx?: number
  /**
   * The OLD meaning of Shift — 0.15× travel. Kept so an unmigrated caller still
   * compiles, but nothing in the app passes it: Shift now means `coarse`, in both
   * the drag and the arrow keys, so the modifier cannot mean two opposite things
   * depending on which gesture the user reached for.
   */
  fine?: boolean
  /**
   * Shift-drag. The value moves at the SAME pixel rate as an unmodified drag but
   * lands only on multiples of ten steps — the identical grid one Shift-arrow press
   * jumps by, which is what makes the two gestures agree.
   *
   * Multiplying the travel by ten instead, the way Photoshop's scrubby sliders do,
   * is unusable here: this scrub maps the WHOLE declared range onto ~260px, so ×10
   * crosses min→max in 26px and Shift degenerates into "slam to an end". Coarsening
   * the grid keeps the gesture controllable and still reads as bigger increments.
   */
  coarse?: boolean
}

export function scrubValue(a: ScrubArgs): number {
  const scrubPx = a.scrubPx && a.scrubPx > 0 ? a.scrubPx : 260
  const step = a.step > 0 ? a.step : 1
  const range = a.max - a.min
  const factor = a.fine ? 0.15 : 1
  const raw = a.startValue + (a.deltaPx / scrubPx) * range * factor
  // Ten steps is `KEY_COARSE_STEPS`, imported rather than repeated so the drag grid
  // and the keyboard jump can never drift apart.
  const grid = a.coarse ? step * KEY_COARSE_STEPS : step
  const snapped = Math.round(raw / grid) * grid
  const clamped = Math.min(a.max, Math.max(a.min, snapped))
  return Number(clamped.toFixed(6))
}
