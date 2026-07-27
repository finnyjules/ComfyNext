import type { ControlSpec } from '~/lib/spacetype/effect'
import type { VtAxis } from './font'
import type { VectorTypeConfig } from './config'
import { derivedAxisControls, visibleVtControls } from './controls'

/** Strip the schema-only fields (`when`/`agent`/`animatable`) a `VtControl` may
 *  carry, and drop anything explicitly withheld from the agent. Mirrors
 *  `shapefx/agentControls.ts` exactly. */
function stripMeta(specs: ControlSpec[]): ControlSpec[] {
  return specs
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, ...spec }: any) => spec as ControlSpec)
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
 */
export function vtAgentControls(cfg: VectorTypeConfig, axes: VtAxis[] = []): ControlSpec[] {
  return [
    ...stripMeta(visibleVtControls(cfg)),
    ...stripMeta(derivedAxisControls(axes)),
  ]
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside vtAgentControls.
 */
export { VT_GUIDANCE } from './controls'
