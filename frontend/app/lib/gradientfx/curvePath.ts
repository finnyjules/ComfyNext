// Curve Studio: turn a parametric CurveConfig into a flat polyline with cumulative
// arc-length. Pure + deterministic. The renderer uploads this into a per-layer
// RGBA32F texture the shader samples (see renderer.uploadCurve).
import { CURVE_DEFAULTS, type CurveConfig, type Vec2 } from './types'

export const CURVE_SAMPLES = 40
export interface CurvePolyline { pts: Float32Array; len: Float32Array; n: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Finite number or the fallback — coerces undefined/NaN/Infinity. */
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Coerce a possibly-partial/malformed curve into a complete, finite CurveConfig.
 *  A partial curve (e.g. an agent dotted-path write that set only some fields) would
 *  otherwise leave a field undefined → `curvature * bend` = NaN → the whole polyline
 *  NaN → a silent all-black render. Defaulting at this pure boundary makes any
 *  partial config degrade gracefully instead. */
function normalizeCurve(c: CurveConfig): CurveConfig {
  const d = CURVE_DEFAULTS
  const s = (c?.start ?? {}) as Partial<Vec2>
  const e = (c?.end ?? {}) as Partial<Vec2>
  return {
    start: { x: num(s.x, d.start.x), y: num(s.y, d.start.y) },
    end: { x: num(e.x, d.end.x), y: num(e.y, d.end.y) },
    shape: c?.shape ?? d.shape,
    curvature: num(c?.curvature, d.curvature),
    bend: num(c?.bend, d.bend),
    waves: num(c?.waves, d.waves),
    phase: num(c?.phase, d.phase),
    mode: c?.mode ?? d.mode,
    width: num(c?.width, d.width),
  }
}

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
    case 'wave': {
      const w = Math.max(1, c.waves)
      const o = (uu: number) => Math.sin((uu * w + c.phase) * Math.PI * 2)
      off = o(u) - ((1 - u) * o(0) + u * o(1))   // pin endpoints exactly, keep the oscillation
      break
    }
    case 'loop':     off = Math.sin(u * Math.PI) * (1 - Math.cos(u * Math.PI * 2)); break
    default:         off = 0
  }
  return { x: bx + px * off * amp, y: by + py * off * amp }
}

export function buildCurvePolyline(cfg: CurveConfig): CurvePolyline {
  const c = normalizeCurve(cfg)
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
