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
