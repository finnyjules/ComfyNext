import type { ControlSpec } from '~/lib/spacetype/effect'
import type { GeoShapeConfig } from './config'
import { visibleGeoControls } from './controls'

/** Strip the schema-only fields (`when`/`agent`/`animatable`/`summary`/`entry`/`optionLabels`)
 *  that `GeoControl` may carry, matching visibleGeoControls's own list — mirrors
 *  shapefx/agentControls.ts's stripMeta. */
function stripMeta(specs: ControlSpec[]): ControlSpec[] {
  return specs
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, summary, entry, optionLabels, ...spec }: any) => spec as ControlSpec)
}

/**
 * geologo's tune vocabulary for the in-product agent, derived from
 * GEO_CONTROLS rather than hand-listed. Only controls that apply to the
 * current shape/layout/overlap/symmetry/clip state are returned, mirroring
 * the surface's own `when` gating so the agent is never offered a knob the
 * user cannot see (e.g. `starInner` when `shape !== 'star'`).
 */
export function geoAgentControls(cfg: GeoShapeConfig): ControlSpec[] {
  return stripMeta(visibleGeoControls(cfg))
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside geoAgentControls, mirroring
 * shapefx/agentControls.ts's re-export of SHAPE_GUIDANCE.
 */
export { GEO_GUIDANCE } from './controls'
