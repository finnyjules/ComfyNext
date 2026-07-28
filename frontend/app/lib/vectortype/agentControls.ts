import type { ControlSpec } from '~/lib/spacetype/effect'
import { isFill } from '~/lib/compositor/paint'
import { getEffectSync } from '~/lib/shaderfx/catalog'
import { SHADER_FILL_CONTROLS, derivedShaderFillControls } from '~/lib/shaderfill/controls'
import type { VtAxis } from './font'
import type { VectorTypeConfig } from './config'
import { derivedAxisControls, visibleVtControls } from './controls'

/** Strip the schema-only fields (`when`/`agent`/`animatable`) a `VtControl` may
 *  carry, and drop anything explicitly withheld from the agent. Mirrors
 *  `shapefx/agentControls.ts` exactly. */
function stripMeta(specs: ControlSpec[]): ControlSpec[] {
  return specs
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, summary, ...spec }: any) => spec as ControlSpec)
}

/**
 * Vector Type's tune vocabulary for the in-product agent, derived from
 * VT_CONTROLS rather than hand-listed. Only controls that apply to the current
 * config are returned, mirroring the surface's own gating so the agent is never
 * offered a knob the user cannot see.
 *
 * `axes` is the LOADED font's axis list ("declare the frame, derive the
 * contents" — see ./controls.ts). It is a parameter rather than a lookup
 * because `loadVariableFont` exposes promises only, with no synchronous cache to
 * read; `shaderAgentControls(config, effectDef)` takes its `EffectDef` the same
 * way for the same reason. Omit it and the studio's static vocabulary is
 * returned unchanged — the axis sliders are simply not derived yet, which is
 * the honest answer before a font has finished loading.
 *
 * ## The shader-fill branch is NOT free — it has to be written out
 *
 * `visibleVtControls` can only ever return members of `VT_CONTROLS`, and
 * `VT_CONTROLS` declares no `fill.shader.*` key at all (the shader vocabulary
 * lives in the shared `~/lib/shaderfill/controls.ts`, so that four host studios
 * do not each keep a copy of it). Measured before writing this branch: on a
 * config whose `fill.type` is `shader`, `vtAgentControls` emitted
 * `text, fontId, size, tracking, align, fill.type, fill.a, fill.b, fillAnchor,
 * strokeWidth, motion.stagger.*` — and not one `fill.shader` key. Nothing
 * derives them; Shape Studio needed the same explicit branch for the same
 * reason (`shapefx/agentControls.ts:35-39`), and this mirrors it line for line.
 *
 * The active effect's own params are appended too, but only when the shader-fx
 * catalog has ALREADY resolved that effect id. This reads the catalog's
 * synchronous cache (`getEffectSync`, never a fetch) rather than taking an
 * `EffectDef` parameter, so the signature stays at `(cfg, axes)` for its three
 * callers. If nothing on the page has fetched the catalog yet the per-effect
 * params are simply absent this call — not wrong, just not derived yet, the same
 * graceful degradation `~/lib/shaderfill/field.ts` accepts for the same reason.
 * (The axes above cannot use that trick: `loadVariableFont` exposes promises
 * only, with no synchronous cache to read, which is why they are a parameter.)
 */
export function vtAgentControls(cfg: VectorTypeConfig, axes: VtAxis[] = []): ControlSpec[] {
  const out = [
    ...stripMeta(visibleVtControls(cfg)),
    ...stripMeta(derivedAxisControls(axes)),
  ]
  // `cfg.fill` is a `Paint`; only its `Fill` arm can carry a shader (a `Gradient`
  // has nowhere to put one), so this narrows before asking the type — the same
  // `isFill` guard `controls.ts`'s own `vtFill` uses.
  const fill = isFill(cfg?.fill) ? cfg.fill : null
  if (fill?.type === 'shader' && fill.shader) {
    out.push(...stripMeta(SHADER_FILL_CONTROLS))
    const effectDef = getEffectSync(fill.shader.effectId)
    // Addressed at `fill.shader.params.<paramId>` — the REAL `ShaderSpec.params`
    // path, so `makeConfigParams` and `getByPath`/`setByPath` land on the stored
    // value with no translation layer. See the module doc on
    // `~/lib/shaderfill/controls.ts` for what a key one segment off that path
    // cost last time (a phantom `fill.shader.p` object, silently never rendered).
    if (effectDef) out.push(...derivedShaderFillControls(effectDef, 'fill.shader'))
  }
  return out
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside vtAgentControls.
 */
export { VT_GUIDANCE } from './controls'
