/**
 * The control sections the Type Studio panel (SpaceTypeSurface) can render, in display order.
 *
 * SINGLE SOURCE OF TRUTH. The panel filters every effect's controls by their `group` against this
 * list — so a control whose `group` is NOT one of these is SILENTLY dropped from the UI (no error,
 * the control just never appears). A unit test (tests/unit/spacetype-sections.unit.spec.ts) guards
 * that every registered effect only uses groups listed here, so this can't recur.
 */
export const SPACE_TYPE_SECTIONS = [
  'Path', 'Type', 'Stack', 'Occlusion', 'Look', 'Blend', 'Style', 'Layout', 'Stretch', 'Skew',
  'Warp', 'Ribbon', 'Spiral', 'Layers', 'Color', 'Stroke', 'Glitch', 'Doodles', 'Shadow', 'Wave',
  'Motion', 'Transform', 'Output',
] as const

export type SpaceTypeSection = typeof SPACE_TYPE_SECTIONS[number]
