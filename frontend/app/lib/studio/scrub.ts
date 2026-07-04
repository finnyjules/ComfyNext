export interface ScrubArgs {
  startValue: number
  deltaPx: number
  min: number
  max: number
  step: number
  scrubPx?: number
  fine?: boolean
}

export function scrubValue(a: ScrubArgs): number {
  const scrubPx = a.scrubPx && a.scrubPx > 0 ? a.scrubPx : 260
  const step = a.step > 0 ? a.step : 1
  const range = a.max - a.min
  const factor = a.fine ? 0.15 : 1
  const raw = a.startValue + (a.deltaPx / scrubPx) * range * factor
  const snapped = Math.round(raw / step) * step
  const clamped = Math.min(a.max, Math.max(a.min, snapped))
  return Number(clamped.toFixed(6))
}
