// Curve Studio: turn a parametric CurveConfig into a flat polyline with cumulative
// arc-length. Pure + deterministic. The renderer uploads this into a per-layer
// RGBA32F texture the shader samples (see renderer.uploadCurve).
import type { CurveConfig, Vec2 } from './types'

export const CURVE_SAMPLES = 40
export interface CurvePolyline { pts: Float32Array; len: Float32Array; n: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Position on the parametric curve at u ∈ [0,1]. Chord from start→end, with a
 *  perpendicular offset that the shape preset shapes. */
function evalCurve(c: CurveConfig, u: number): Vec2 {
  const sx = c.start.x, sy = c.start.y, ex = c.end.x, ey = c.end.y
  // Base point on the straight chord.
  const bx = lerp(sx, ex, u), by = lerp(sy, ey, u)
  if (c.shape === 'line' || c.curvature <= 1e-6) return { x: bx, y: by }
  // Perpendicular unit of the chord (normalized).
  const dx = ex - sx, dy = ey - sy
  const L = Math.hypot(dx, dy) || 1e-6
  const px = -dy / L, py = dx / L
  const amp = c.curvature * c.bend * 0.5   // max offset = 0.5 frame at curvature 1
  let off = 0
  switch (c.shape) {
    case 'arc':      off = Math.sin(u * Math.PI); break                       // single bow
    case 's-curve':  off = Math.sin(u * Math.PI * 2); break                   // two opposing bows
    case 'wave':     off = Math.sin((u * Math.max(1, c.waves) + c.phase) * Math.PI * 2); break
    case 'loop':     off = Math.sin(u * Math.PI) * (1 - Math.cos(u * Math.PI * 2)); break
    default:         off = 0
  }
  return { x: bx + px * off * amp, y: by + py * off * amp }
}

export function buildCurvePolyline(c: CurveConfig): CurvePolyline {
  const n = CURVE_SAMPLES
  const pts = new Float32Array(n * 2)
  const len = new Float32Array(n)
  let prev = evalCurve(c, 0)
  pts[0] = prev.x; pts[1] = prev.y; len[0] = 0
  let acc = 0
  for (let k = 1; k < n; k++) {
    const u = k / (n - 1)
    const cur = evalCurve(c, u)
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    pts[k * 2] = cur.x; pts[k * 2 + 1] = cur.y; len[k] = acc
    prev = cur
  }
  // Normalize arc-length to 0..1 (guard a zero-length degenerate curve).
  const total = acc > 1e-9 ? acc : 1
  for (let k = 0; k < n; k++) len[k] = len[k]! / total
  len[n - 1] = 1  // pin exact
  return { pts, len, n }
}
