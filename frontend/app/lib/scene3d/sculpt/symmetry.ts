// Stroke symmetry: one brush stamp expanded into several, so a single stroke
// sculpts mirrored or radially repeated copies.
//
// Radial symmetry is implemented now even though phase 3 only exposes mirror
// in the UI (Task 15 wires up the count control). The machinery for rotating
// a stamp about an axis is identical whether the caller ever asks for more
// than a mirror pair, and splitting it out later would mean editing this file
// twice for no benefit.
import type { BrushStamp } from '~/lib/scene3d/sculpt/brushes'

export type SymmetryMode = 'none' | 'mirror' | 'radial'

export interface SymmetrySpec {
  mode: SymmetryMode
  /** Which axis mirroring negates / radial rotates about: 0=X, 1=Y, 2=Z. */
  axis: 0 | 1 | 2
  /** Radial only: how many copies (including the original) around the axis. */
  count: number
}

function cloneStamp(stamp: BrushStamp): BrushStamp {
  return {
    centre: [stamp.centre[0], stamp.centre[1], stamp.centre[2]],
    normal: [stamp.normal[0], stamp.normal[1], stamp.normal[2]],
    radius: stamp.radius,
    strength: stamp.strength,
    invert: stamp.invert,
    // `drag` is a DIRECTION (grab's pointer delta), not a position — copying
    // it unchanged would drag every mirrored/radial copy the same way as the
    // original, which is wrong in a different, more confusing way than
    // dropping it (applyBrush's `if (!drag) continue` at least no-ops
    // visibly). Callers below transform it the same way they transform
    // `centre`/`normal`. Absent stays absent.
    ...(stamp.drag ? { drag: [stamp.drag[0], stamp.drag[1], stamp.drag[2]] } : {}),
  }
}

/** Mirror negates the `axis` component of `centre`, `normal`, AND `drag` — the
 *  normal must flip too, or every mirrored stroke ends up tilted the wrong
 *  way, which reads as a lighting bug rather than a symmetry bug. `drag` is a
 *  direction, so it mirrors the same way: a mirrored grab must pull the
 *  mirrored side in the mirrored direction. */
function mirrorStamp(stamp: BrushStamp, axis: 0 | 1 | 2): BrushStamp {
  const out = cloneStamp(stamp)
  out.centre[axis] = -out.centre[axis]
  out.normal[axis] = -out.normal[axis]
  if (out.drag) out.drag[axis] = -out.drag[axis]
  return out
}

/** Rotate a 3-vector by `angle` radians about `axis`, in place on a copy. */
function rotateAbout(v: [number, number, number], axis: 0 | 1 | 2, angle: number): [number, number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // The two components perpendicular to `axis`, in a fixed cyclic order.
  const a = (axis + 1) % 3
  const b = (axis + 2) % 3
  const va = v[a]!
  const vb = v[b]!
  const out: [number, number, number] = [v[0], v[1], v[2]]
  out[a] = va * cos - vb * sin
  out[b] = va * sin + vb * cos
  return out
}

function radialStamp(stamp: BrushStamp, axis: 0 | 1 | 2, angle: number): BrushStamp {
  const out = cloneStamp(stamp)
  out.centre = rotateAbout(stamp.centre, axis, angle)
  out.normal = rotateAbout(stamp.normal, axis, angle)
  // `drag` is a direction, so it rotates the same way as `normal` — a radial
  // grab copy must pull in the rotated direction, not the original one.
  if (stamp.drag) out.drag = rotateAbout(stamp.drag, axis, angle)
  return out
}

export function expandStamp(stamp: BrushStamp, spec: SymmetrySpec): BrushStamp[] {
  if (spec.mode === 'mirror') {
    return [stamp, mirrorStamp(stamp, spec.axis)]
  }
  if (spec.mode === 'radial' && spec.count > 1) {
    const out: BrushStamp[] = []
    for (let i = 0; i < spec.count; i++) {
      out.push(radialStamp(stamp, spec.axis, (i * 2 * Math.PI) / spec.count))
    }
    return out
  }
  return [stamp]
}
