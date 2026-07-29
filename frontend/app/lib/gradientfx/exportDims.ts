/**
 * Uniform-scale clamp for export dimensions.
 *
 * Clamping each axis independently (`Math.min(w, max)`, `Math.min(h, max)`)
 * does NOT preserve aspect ratio: a 9:16 export requested at 4K width comes
 * out 4096x7282, and per-axis clamping turns that into a square 4096x4096.
 * The bug is silent — no error, just a squashed render (and a squashed
 * poster, baked from the same wrong canvas).
 *
 * This scales both axes by the same factor, so the longer edge is capped at
 * `max` and the aspect ratio survives.
 *
 * Shared by GradientStudioSurface.vue's still-image export
 * (`renderCurrentBlob`) and its web-embed export (`exportWebEmbed`) so the
 * two paths agree on sizing.
 */
export function clampExportDims(w: number, h: number, max = 4096): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
