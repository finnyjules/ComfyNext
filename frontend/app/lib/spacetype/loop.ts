/** Quantized frame index for a preview at `fps` after `elapsedMs` of wall-clock time,
 *  wrapped into the multi-loop window `base * k` (base = fps × loopDuration). The preview
 *  advances at `fps`, not the display refresh rate — the render loop compares this index
 *  frame-to-frame and skips repaints that map to the SAME index (a byte-identical scene),
 *  so a 120Hz/ProMotion display no longer re-renders each frame 2-4× (see startPreview). */
export function previewFrameAt(elapsedMs: number, fps: number, base: number, k: number): number {
  return Math.floor((elapsedMs / 1000) * fps) % Math.max(1, base * k)
}

/** Smallest k in [1, cap] such that every rate × k is within eps of a whole number — so all
 *  motions complete whole cycles over k loops (seamless). Empty rates → 1; if none qualifies
 *  (e.g. an off-grid/irrational rate), returns cap as best effort. */
export function loopMultiplier(rates: number[], cap = 60, eps = 1e-3): number {
  const r = rates.filter(v => Math.abs(v) > eps)
  if (!r.length) return 1
  for (let k = 1; k <= cap; k++) {
    if (r.every(v => Math.abs(v * k - Math.round(v * k)) < eps)) return k
  }
  return cap
}
