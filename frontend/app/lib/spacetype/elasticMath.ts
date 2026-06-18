/**
 * Pure reference for the Elastic vertex displacement. The GLSL in
 * effects/elastic.ts mirrors this 1:1 — keep them in sync. No Three.js, so it
 * unit-tests in node and documents the loop-seamlessness contract.
 *
 * Seamlessness: every mode's offset at uTime=0 must equal its offset at
 * uTime=TAU, so the baked loop's first and last frames match. This is why all
 * time multipliers are integers (or are gated by a sin(uTime) factor that is 0
 * at both endpoints) — fractional, ungated multipliers would break the loop.
 */

export type ElasticMode = 0 | 1 | 2 | 3 | 4 // Wave, Spring, Taffy, Pinch, Jelly

export const ELASTIC_MODES = ['Wave', 'Spring', 'Taffy', 'Pinch', 'Jelly'] as const

export const TAU = Math.PI * 2

export interface ElasticParams {
  intensity: number
  stretch: number
  shear: number
  waveLength: number
}

/**
 * Displacement for one vertex.
 *  px, py : plane-local position (centered; ~[-w/2,w/2] x [-h/2,h/2]).
 *  lineT  : this line's normalized index in the stack, 0..1.
 *  uTime  : loop phase (caller passes t01 * cycles * TAU).
 * Returns world-space dx, dy already scaled by intensity.
 */
export function elasticOffset(
  mode: ElasticMode, px: number, py: number, lineT: number, uTime: number, p: ElasticParams,
): { dx: number; dy: number } {
  if (p.intensity === 0) return { dx: 0, dy: 0 }
  let dx = 0
  let dy = 0
  switch (mode) {
    case 0: { // Wave — traveling shear + vertical stretch flowing down the stack
      const phase = px * p.waveLength + lineT * TAU + uTime
      dx = Math.sin(phase) * p.shear
      dy = Math.cos(phase) * p.stretch * py
      break
    }
    case 1: { // Spring — global squash/stretch, periodic damped-overshoot shape
      const env = Math.sin(uTime) * Math.cos(uTime * 0.5) // 0 at uTime=0 and uTime=TAU
      dx = px * env * p.shear * 0.5
      dy = py * env * p.stretch
      break
    }
    case 2: { // Taffy — low-freq high-drag horizontal smear, heavier toward the bottom
      const drag = 0.5 + lineT
      dx = Math.sin(uTime + py * p.waveLength * 0.3) * p.shear * 2 * drag
      dy = Math.sin(uTime * 0.5) * p.stretch * 0.25 * py
      break
    }
    case 3: { // Pinch — radial bulge/pinch from a center sliding along x
      const cx = Math.sin(uTime) * 0.5
      const ex = px - cx
      const ey = py
      const dist = Math.sqrt(ex * ex + ey * ey) + 1e-3
      const w = (Math.sin(dist * p.waveLength - uTime) * p.stretch) / (1 + dist)
      dx = (ex / dist) * w
      dy = (ey / dist) * w
      break
    }
    default: { // 4: Jelly — summed multi-axis ripple (integer time multipliers → loops)
      dx = (Math.sin(uTime + py * p.waveLength) + Math.sin(2 * uTime + py * p.waveLength * 2) * 0.5) * p.shear
      dy = (Math.cos(uTime + px * p.waveLength) + Math.cos(2 * uTime + px * p.waveLength * 2) * 0.5) * p.stretch
      break
    }
  }
  return { dx: dx * p.intensity, dy: dy * p.intensity }
}
