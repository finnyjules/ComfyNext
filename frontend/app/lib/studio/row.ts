/**
 * Pure geometry and value handling for a studio control row. Kept out of
 * StudioRow.vue so it is testable without a DOM — the row's visual behaviour and
 * its reset behaviour must agree, and the only way to prove that is here.
 */

/** A range that crosses zero. BOTH the fill origin and the double-click reset
 *  target key off this predicate, so a bipolar slider's fill can never grow from
 *  the left while its reset snaps to the middle. */
export function isBipolar(min: number, max: number): boolean {
  return min < 0 && max > 0
}

/** Where the fill starts, 0..1 across the row. Centre-ish for a bipolar range
 *  (wherever zero actually falls), hard left otherwise. */
export function fillOrigin(min: number, max: number): number {
  if (!isBipolar(min, max)) return 0
  const range = max - min
  return range > 0 ? (0 - min) / range : 0
}

/** The value's position, 0..1. Clamped — a value outside the range pins to an end
 *  rather than painting past the row. */
export function fillFraction(value: number, min: number, max: number): number {
  const range = max - min
  if (!(range > 0)) return 0
  return Math.min(1, Math.max(0, (value - min) / range))
}

/** Decimal places implied by a step: 0.01 → 2, 1 → 0. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const s = String(step)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

export function formatValue(value: number, step: number): string {
  return Number(value).toFixed(stepDecimals(step))
}

/** Parse a typed value. Returns null when it is not a number so the caller can
 *  revert the field instead of writing NaN through to the document. Stray units
 *  are stripped because people paste "42px" out of dev tools. */
export function parseTyped(input: string, min: number, max: number, step: number): number | null {
  const cleaned = String(input).trim().replace(/[^0-9eE+\-.]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  const snapped = step > 0 ? Math.round(n / step) * step : n
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6))
}

/** Double-click target. A declared default always wins — including a default of 0,
 *  which is why this tests for null rather than falsiness. Without one, this is the
 *  legacy heuristic lifted from plugins/studio-reset.client.ts. */
export function resetValue(opts: { default?: number; min: number; max: number }): number {
  const d = opts.default
  if (d != null && Number.isFinite(d)) return d
  return isBipolar(opts.min, opts.max) ? 0 : opts.min
}
