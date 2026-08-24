import { coarseStepMultiplier, type EntryMode } from './row'

export interface ScrubArgs {
  startValue: number
  deltaPx: number
  min: number
  max: number
  step: number
  scrubPx?: number
  /**
   * SOFT RANGE, and it belongs here as much as it belongs on the keyboard.
   *
   * This scrub is RELATIVE — `startValue + (deltaPx / scrubPx) × range` — so the range
   * only sets the travel RATE. The one thing that pulled an out-of-range value back
   * inside was the terminal clamp below, and a 3px accidental drag on a Transform row
   * reading 35 therefore wrote 20 and fanned the −15 difference across the whole
   * selection: exactly the hazard `entry: 'unclamped'` exists to remove, and net-new
   * against the `<input type="number">` grid, which had no drag at all.
   *
   * Click-to-position (StudioRow.vue's `up()`) stays clamped in both modes, because THAT
   * gesture is absolute: it means "put the value at this place on the track", and the
   * track is the declared range.
   */
  entry?: EntryMode
  /**
   * The OLD meaning of Shift — 0.15× travel.
   *
   * Still live, and only OUTSIDE the studios: `app/plugins/scrub.client.ts` passes
   * `fine: ev.shiftKey` for the `v-scrub` directive, whose one user is
   * GridPropertyPanel. So Shift means FINE on a `v-scrub` handle and COARSE on a
   * studio row. That is a real inconsistency, left standing because migrating the
   * directive is not this change's job — but it is not "nothing passes it", which is
   * what this comment used to claim.
   */
  fine?: boolean
  /**
   * Shift-drag. The value moves at the SAME pixel rate as an unmodified drag but only
   * on multiples of `coarseStepMultiplier` steps AWAY FROM WHERE THE DRAG STARTED —
   * so one coarse drag increment is exactly one Shift-arrow press.
   *
   * The relative part is load-bearing. An ABSOLUTE ×10 grid does not agree with the
   * keys: `nudgeValue` adds ten steps to the current value, so from 13 on a 0..100
   * step-1 control a Shift-arrow gives 23 while an absolute grid snaps to 20. This
   * file used to assert the two matched; they did not.
   *
   * Multiplying the travel by ten instead, the way Photoshop's scrubby sliders do, is
   * unusable here: this scrub maps the WHOLE declared range onto ~260px, so ×10 crosses
   * min→max in 26px and Shift degenerates into "slam to an end". Coarsening the grid
   * keeps the gesture controllable and still reads as bigger increments.
   */
  coarse?: boolean
}

export function scrubValue(a: ScrubArgs): number {
  const scrubPx = a.scrubPx && a.scrubPx > 0 ? a.scrubPx : 260
  const step = a.step > 0 ? a.step : 1
  const range = a.max - a.min
  const factor = a.fine ? 0.15 : 1
  const raw = a.startValue + (a.deltaPx / scrubPx) * range * factor
  let snapped: number
  if (a.coarse) {
    // The jump size is imported rather than repeated, so the drag and the keyboard
    // cannot drift apart — including on short ranges, where it shrinks below ten.
    const grid = step * coarseStepMultiplier(a.min, a.max, step)
    const candidate = a.startValue + Math.round((raw - a.startValue) / grid) * grid
    // ...then onto the declared step grid, the way `nudgeValue` hands its candidate to
    // `parseTyped`. A start value that was somehow off-grid cannot survive the gesture.
    snapped = Math.round(candidate / step) * step
  } else {
    snapped = Math.round(raw / step) * step
  }
  const bounded = a.entry === 'unclamped' ? snapped : Math.min(a.max, Math.max(a.min, snapped))
  return Number(bounded.toFixed(6))
}
