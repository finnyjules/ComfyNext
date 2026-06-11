/** Variable-font axis animation — shared by the Frame kinetic bake
 *  (`useKineticRenderer`) and the timeline Motion clip. Interpolates OpenType
 *  axis values over normalized time and formats them as CSS
 *  font-variation-settings. One implementation, two consumers. */

/** A keyframe for variable-font axis animation. Axes interpolate between
 *  keyframes over the animation's duration. */
export interface AxisKeyframe {
  /** Normalized time 0..1 within the animation duration. */
  t: number
  /** Axis values at this keyframe. Only axes present are animated;
   *  missing axes hold their static value from the font state. */
  axes: Record<string, number>
  ease?: string  // GSAP ease for the segment *from* this keyframe to the next
}

/**
 * Interpolate variable-font axis values at a normalized time `t` (0..1).
 * Returns the interpolated axes merged with static defaults.
 *
 * Interpolation is linear between bracketing keyframes (the per-keyframe
 * `ease` field is reserved for future segment easing and is not yet applied).
 */
export function interpolateAxes(
  keyframes: AxisKeyframe[],
  t: number,
  staticAxes: Record<string, number>,
): Record<string, number> {
  if (!keyframes.length) return staticAxes

  const sorted = keyframes.length > 1
    ? [...keyframes].sort((a, b) => a.t - b.t)
    : keyframes

  // Clamp t
  const ct = Math.max(0, Math.min(1, t))

  // Before first keyframe or only one keyframe
  if (ct <= sorted[0].t || sorted.length === 1) {
    return { ...staticAxes, ...sorted[0].axes }
  }
  // After last keyframe
  const last = sorted[sorted.length - 1]
  if (ct >= last.t) {
    return { ...staticAxes, ...last.axes }
  }

  // Find bracketing keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (ct >= a.t && ct <= b.t) {
      const span = b.t - a.t
      const frac = span > 0 ? (ct - a.t) / span : 0

      // Collect all axis tags that appear in either keyframe
      const allTags = new Set([...Object.keys(a.axes), ...Object.keys(b.axes)])
      const result = { ...staticAxes }
      for (const tag of allTags) {
        const va = a.axes[tag] ?? staticAxes[tag] ?? 0
        const vb = b.axes[tag] ?? staticAxes[tag] ?? 0
        result[tag] = va + (vb - va) * frac
      }
      return result
    }
  }

  return { ...staticAxes, ...last.axes }
}

/** Build a CSS `font-variation-settings` string from an axes record. */
export function axesToVariationSettings(axes: Record<string, number>): string {
  return Object.entries(axes).map(([tag, v]) => `"${tag}" ${v}`).join(', ')
}
