// Repeat transform for the gradient ramp coordinate `t`. Kept as a standalone
// pure function so it is unit-testable without a GL context AND is the exact
// twin of the GLSL `applyRepeat` in shaders.ts — the two MUST stay identical.
import type { RepeatKind } from './types'

export const REPEAT_IDX: Record<RepeatKind, number> = { once: 0, mirror: 1, tile: 2 }

/** mode: 0 once, 1 mirror, 2 tile. Matches the GLSL twin verbatim. */
export function applyRepeat(t: number, mode: number, count: number): number {
  if (mode < 0.5) return t
  const n = Math.max(1, count)
  const fract = (x: number) => x - Math.floor(x)
  if (mode < 1.5) return 1 - Math.abs(fract(t * n * 0.5) * 2 - 1) // mirror (reflect)
  return fract(t * n)                                              // tile
}
