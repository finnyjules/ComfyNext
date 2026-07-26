import type { ControlSpec } from '~/lib/spacetype/effect'
import type { ShapeConfig } from './config'
import { visibleShapeControls } from './controls'

/**
 * Shape Studio's tune vocabulary for the in-product agent, derived from
 * SHAPE_CONTROLS rather than hand-listed. Only controls that apply to the current
 * fill mode and shape mode are returned, mirroring the surface's own v-if gating
 * so the agent is never offered a knob the user cannot see.
 */
export function shapeAgentControls(cfg: ShapeConfig): ControlSpec[] {
  return visibleShapeControls(cfg)
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, ...spec }: any) => spec as ControlSpec)
}

/**
 * Domain guidance injected into the /api/vibe prompt. Owned by controls.ts
 * (co-located with the schema it describes); re-exported here so the agent
 * wiring has a single import surface alongside shapeAgentControls.
 */
export { SHAPE_GUIDANCE } from './controls'
