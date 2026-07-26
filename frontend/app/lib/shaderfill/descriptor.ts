/**
 * Pure descriptor logic for shader fills — cache keys, time quantisation, and the
 * live-field budget. Deliberately free of canvas/GL/three so it is unit-testable in
 * the node environment; all rendering lives in ./field.ts.
 */
import { effectiveTileFill, type Fill, type ShaderSpec } from '~/lib/spacetype/fillTile'
import type { EffectDef } from '~/lib/shaderfx/types'

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

/** Keys the fill that will ACTUALLY be rendered, not necessarily `f` itself.
 *  `field.ts` never rasterises `spec.input` raw — it unwraps a shader-typed input via
 *  `effectiveTileFill` first (depth-1 nesting is enforced only at the
 *  normalizeFill/parseFills parse boundary, not in the type system, so a
 *  hand-constructed spec can still carry a shader fill as its `input`). Encoding the
 *  raw `f` here would drop `f.shader` entirely — two specs whose shader-typed
 *  `input`s differ only in their nested content would key IDENTICALLY while
 *  rendering two different images, the same silent-wrong-pixels class `fieldKey`
 *  exists to prevent. Running `f` through the SAME `effectiveTileFill` the renderer
 *  uses makes key and render agree by construction: whatever fill effectiveTileFill
 *  resolves to is never itself shader-typed (see its own doc in fillTile.ts), so once
 *  unwrapped there is no `.shader` left to lose. */
export function inputKey(f: Fill): string {
  const eff = effectiveTileFill(f)
  return encode([eff.type, eff.a, eff.b, eff.angle, eff.density])
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

/** The time/size-INVARIANT half of `fieldKey` — every component except `w`, `h`, `t`.
 *  Names the descriptor itself, not one frame of it. `fields.ts` (Space Type/Shape
 *  Studio's persistent `THREE.CanvasTexture` cache) needs an identity that does NOT
 *  change as time advances — that texture OBJECT is held by a material for the life of
 *  the fill, only its pixels change frame to frame — so `fieldKey` itself (which folds
 *  `t` in) cannot serve as that cache's key. Shares `encode`/`paramsKey`/`inputKey` with
 *  `fieldKey` rather than a hand-rolled second scheme, so the two can never silently
 *  disagree about what "the same descriptor" means. `spec.params` MUST already be
 *  resolved (see `resolveEffectParams`'s doc) before calling this, same precondition as
 *  `fieldKey`. */
export function specIdentityKey(spec: ShaderSpec): string {
  return encode([spec.effectId, paramsKey(spec.params), spec.anchor, spec.speed, inputKey(spec.input)])
}

/** The catalog stores each param's uniform name WITH the `u_` prefix already applied
 *  (e.g. `"uniform": "u_amount"` in shader_effects/manifest.json) — see EffectParamDef
 *  in ~/lib/shaderfx/types. ShaderSpec.params (and the Task 8 control schema, addressed
 *  as `fill.shader.p.<key>`) is keyed WITHOUT that prefix, so this strips it back off.
 *  Exported (not just used internally) so `~/lib/shaderfill/controls.ts`'s
 *  `derivedShaderFillControls` builds its `fill.shader.p.<key>` keys from the SAME
 *  stripping rule `resolveEffectParams` uses to read `params` back — one definition of
 *  "the unprefixed name", not two that could drift. */
export function unprefixedKey(uniform: string): string {
  return uniform.startsWith('u_') ? uniform.slice(2) : uniform
}

/** Resolve a shader spec's raw params against an effect's declared defaults: every
 *  param the effect declares gets a value (the override if present, finite, and (for
 *  enums) one of its declared option values — otherwise the default), clamped to the
 *  param's min/max. Any key in `params` the effect doesn't declare is dropped.
 *
 *  MUST run before `fieldKey` — an empty `params: {}` and a `params: { amount: 0.12 }`
 *  where 0.12 IS `amount`'s default render identical pixels but would key differently
 *  under the raw params, silently halving the batching hit rate (ten shapes sharing a
 *  fill would key as two groups instead of one). Feed the SAME resolved object to both
 *  `fieldKey` and the uniform upload, not the raw `spec.params` to one and this to the
 *  other — that would just move the mismatch rather than closing it. Pure (no catalog
 *  access of its own): the caller resolves `effect` and passes it in. */
export function resolveEffectParams(effect: EffectDef, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of effect.params) {
    const key = unprefixedKey(p.uniform)
    const raw = params[key]
    if (p.type === 'enum') {
      const values = (p.options ?? []).map(o => o.value)
      out[key] = typeof raw === 'number' && values.includes(raw) ? raw : p.default
    } else {
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default
      out[key] = Math.min(Math.max(v, p.min ?? -Infinity), p.max ?? Infinity)
    }
  }
  return out
}

/** Split distinct field keys into those rendered live and those frozen at t=0.
 *  Callers MUST surface a hint when `frozen` is non-empty — never truncate silently. */
export function planFields(keys: string[]): { live: string[]; frozen: string[] } {
  const distinct = [...new Set(keys)]
  return { live: distinct.slice(0, LIVE_FIELD_CEILING), frozen: distinct.slice(LIVE_FIELD_CEILING) }
}
