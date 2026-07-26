/**
 * Pure descriptor logic for shader fills — cache keys, time quantisation, and the
 * live-field budget. Deliberately free of canvas/GL/three so it is unit-testable in
 * the node environment; all rendering lives in ./field.ts.
 */
import type { Fill, ShaderSpec } from '~/lib/spacetype/fillTile'

/** Measured, not guessed: a live 512² field costs ~1.25ms typically / ~3.6ms worst-observed,
 *  almost entirely readback. At the worst case, 4 fields is ~14ms — under half a 30fps frame,
 *  leaving room for the surface's own render. 8 fields measured 28.65ms worst, which would
 *  consume nearly the whole budget on fills alone. Do not raise this without re-measuring. */
export const LIVE_FIELD_CEILING = 4

/** Snap time to the HOST's frame interval, not a fixed constant — a 60fps bake must
 *  get 60 distinct fields per second or the fill stutters against everything else. */
export function quantizeTime(t: number, fps: number): number {
  const f = fps > 0 ? fps : 30
  return Math.floor(t * f) / f
}

function inputKey(f: Fill): string {
  return `${f.type}|${f.a}|${f.b}|${f.angle}|${f.density}`
}

function paramsKey(p: Record<string, number>): string {
  return Object.keys(p).sort().map(k => `${k}=${p[k]}`).join(',')
}

/** Fields are keyed by DESCRIPTOR, not by consumer. That is the whole batching rule:
 *  ten shapes sharing one shader fill produce one key and therefore one render. */
export function fieldKey(spec: ShaderSpec, w: number, h: number, tq: number): string {
  const t = spec.speed === 0 ? 'static' : String(tq)
  return [spec.effectId, paramsKey(spec.params), spec.anchor, spec.speed,
          inputKey(spec.input), `${w}x${h}`, t].join('|')
}

/** Split distinct field keys into those rendered live and those frozen at t=0.
 *  Callers MUST surface a hint when `frozen` is non-empty — never truncate silently. */
export function planFields(keys: string[]): { live: string[]; frozen: string[] } {
  const distinct = [...new Set(keys)]
  return { live: distinct.slice(0, LIVE_FIELD_CEILING), frozen: distinct.slice(LIVE_FIELD_CEILING) }
}
