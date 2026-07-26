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

/** JSON-encode the component values as an array rather than joining with a delimiter
 *  character — free-form strings (effectId, Fill.a/b, param names) can themselves
 *  contain any delimiter we'd choose, and a hand-rolled join collides silently when
 *  they do. JSON.stringify escapes embedded quotes/brackets, so array position — not
 *  a character that might appear inside a field — is what disambiguates components.
 *
 *  Plain `JSON.stringify` collapses NaN/Infinity/-Infinity to `null`, which would
 *  re-open the same collision class it closes (a NaN speed keying identically to an
 *  Infinity speed, or a NaN param colliding with an explicit null one). The replacer
 *  swaps each non-finite number for a distinct sentinel string BEFORE stringification
 *  sees it, so they stay disambiguated the same way any other value is. */
function encode(parts: unknown[]): string {
  return JSON.stringify(parts, (_key, value) =>
    typeof value === 'number' && !Number.isFinite(value)
      ? (Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity')
      : value)
}

function inputKey(f: Fill): string {
  return encode([f.type, f.a, f.b, f.angle, f.density])
}

/** Sorted [key, value] pairs, not a hand-joined string — sorting normalises order
 *  (so param order doesn't matter) while `encode` keeps arbitrary key text, including
 *  '=' or ',', from bleeding into neighbouring pairs. */
function paramsKey(p: Record<string, number>): string {
  return encode(Object.keys(p).sort().map(k => [k, p[k]]))
}

/** Fields are keyed by DESCRIPTOR, not by consumer. That is the whole batching rule:
 *  ten shapes sharing one shader fill produce one key and therefore one render. */
export function fieldKey(spec: ShaderSpec, w: number, h: number, tq: number): string {
  const t = spec.speed === 0 ? 'static' : tq
  return encode([spec.effectId, paramsKey(spec.params), spec.anchor, spec.speed,
                 inputKey(spec.input), w, h, t])
}

/** Split distinct field keys into those rendered live and those frozen at t=0.
 *  Callers MUST surface a hint when `frozen` is non-empty — never truncate silently. */
export function planFields(keys: string[]): { live: string[]; frozen: string[] } {
  const distinct = [...new Set(keys)]
  return { live: distinct.slice(0, LIVE_FIELD_CEILING), frozen: distinct.slice(LIVE_FIELD_CEILING) }
}
