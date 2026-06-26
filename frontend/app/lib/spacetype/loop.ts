import type { Params } from './effect'

/** Smallest k in [1, cap] such that, for every loopKey, value × k is within eps of a whole number
 *  — so all periodic motions complete whole cycles over k loops (seamless). Empty/absent loopKeys
 *  → 1; if none qualifies (e.g. an irrational speed), returns cap as best effort. */
export function loopMultiplier(params: Params, loopKeys: string[] | undefined, cap = 60, eps = 1e-3): number {
  const speeds = (loopKeys ?? []).map(k => Number(params[k]) || 0).filter(v => Math.abs(v) > eps)
  if (!speeds.length) return 1
  for (let k = 1; k <= cap; k++) {
    if (speeds.every(v => Math.abs(v * k - Math.round(v * k)) < eps)) return k
  }
  return cap
}
