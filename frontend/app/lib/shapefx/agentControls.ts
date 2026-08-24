import type { ControlSpec } from '~/lib/spacetype/effect'
import { getEffectSync } from '~/lib/shaderfx/catalog'
import { getShaderFillControls, derivedShaderFillControls } from '~/lib/shaderfill/controls'
import type { ShapeConfig } from './config'
import { visibleShapeControls } from './controls'

/** Strip the schema-only fields (`when`/`agent`/`animatable`/`summary`/`entry`) that `ShapeControl`
 *  and `getShaderFillControls()` may carry, matching visibleShapeControls's own list. */
function stripMeta(specs: ControlSpec[]): ControlSpec[] {
  return specs
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, summary, entry, ...spec }: any) => spec as ControlSpec)
}

/**
 * Shape Studio's tune vocabulary for the in-product agent, derived from
 * SHAPE_CONTROLS rather than hand-listed. Only controls that apply to the current
 * fill mode and shape mode are returned, mirroring the surface's own v-if gating
 * so the agent is never offered a knob the user cannot see.
 *
 * Shader fill (Task 8's "declare the frame, derive the contents" — see
 * ~/lib/shaderfill/controls.ts): when `cfg.fill.type === 'shader'`, the three
 * frozen `fill.shader.*` keys are appended, same "only when visible" rule as
 * everything else here. The active effect's own params are appended too, but only
 * when the shader-fx catalog has ALREADY resolved that effect id — this reads the
 * catalog's synchronous cache (`getEffectSync`, never a fetch) rather than taking
 * an `EffectDef` parameter, so this function's signature stays unchanged for its
 * three existing callers. If nothing on the page has fetched the catalog yet, the
 * per-effect params are simply absent this call (graceful, matches
 * `~/lib/shaderfill/field.ts`'s own use of `getEffectSync` for the same reason) —
 * not wrong, just not derived yet.
 */
export function shapeAgentControls(cfg: ShapeConfig): ControlSpec[] {
  const out = stripMeta(visibleShapeControls(cfg))
  if (cfg.fill.type === 'shader' && cfg.fill.shader) {
    out.push(...stripMeta(getShaderFillControls()))
    const effectDef = getEffectSync(cfg.fill.shader.effectId)
    if (effectDef) out.push(...derivedShaderFillControls(effectDef, 'fill.shader'))
  }
  return out
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside shapeAgentControls.
 */
export { SHAPE_GUIDANCE } from './controls'
