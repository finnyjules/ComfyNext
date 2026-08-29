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

/**
 * How far a pointer must travel on a plain `<input type="number">` before the gesture
 * counts as a scrub rather than a click. Below this the press stays a click, so
 * click-to-place-caret-and-type is untouched. Matches StudioRow's own 2px dead zone in
 * spirit, a touch larger because these fields have no separate readout to click.
 */
export const SCRUB_THRESHOLD_PX = 3

export interface ScrubInputArgs {
  startValue: number
  deltaPx: number
  step: number
  /** Absent / non-finite = unbounded on that side (rotation, W, H, fontSize all lack a max). */
  min?: number
  max?: number
  /** Shift held — widen the grid to `coarseMultiplier` steps, same travel rate. */
  coarse?: boolean
  /** Pixels of horizontal travel per one step. 1 = Figma's 1:1 feel (the default). */
  pxPerStep?: number
  /** Grid width Shift snaps to, in steps. Fixed default 10 — see note below. */
  coarseMultiplier?: number
}

/**
 * Drag-to-scrub for the Compositor modal's plain number inputs. A SEPARATE model from
 * `scrubValue` on purpose: that one maps a control's whole declared range onto ~260px,
 * which needs a finite `max`. These fields (X/Y/W/H, rotation, size, spacing…) mostly
 * declare none, so there is no range to map — this counts steps per pixel instead, the
 * way Figma/Blender/Photoshop scrubby number fields do.
 *
 * It still reuses `scrubValue`'s two hard-won conventions verbatim: Shift COARSENS the
 * grid at the same travel rate (rounding the travel to a `step × mult` grid, measured
 * from the start value so an off-grid start survives) rather than speeding the drag, and
 * every result is stripped of IEEE-754 dust with `toFixed(6)`.
 *
 * Shift uses a FIXED ×10, not `coarseStepMultiplier`: that helper shrinks the jump on
 * short ranges and returns 1 on an INFINITE span — which is exactly the unbounded field
 * (rotation, W, H) where a working Shift matters most. A flat ×10 is what the brief calls
 * for and is the only multiplier that survives a missing `max`.
 */
export function scrubInputValue(a: ScrubInputArgs): number {
  const step = Number.isFinite(a.step) && a.step > 0 ? a.step : 1
  const pxPerStep = a.pxPerStep && a.pxPerStep > 0 ? a.pxPerStep : 1
  const raw = a.startValue + (a.deltaPx / pxPerStep) * step
  let snapped: number
  if (a.coarse) {
    const mult = a.coarseMultiplier && a.coarseMultiplier > 0 ? a.coarseMultiplier : 10
    const grid = step * mult
    const candidate = a.startValue + Math.round((raw - a.startValue) / grid) * grid
    snapped = Math.round(candidate / step) * step
  } else {
    snapped = Math.round(raw / step) * step
  }
  const lo = Number.isFinite(a.min as number) ? (a.min as number) : -Infinity
  const hi = Number.isFinite(a.max as number) ? (a.max as number) : Infinity
  const bounded = Math.min(hi, Math.max(lo, snapped))
  return Number(bounded.toFixed(6))
}
