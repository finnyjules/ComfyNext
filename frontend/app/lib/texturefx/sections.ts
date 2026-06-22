// SINGLE SOURCE OF TRUTH — any control whose `group` is not listed here is
// silently dropped from the panel. Guarded by texturefx-controls.unit.spec.ts.
export const TEXTURE_SECTIONS = ['Lattice', 'Content', 'Color', 'Output'] as const
export type TextureSection = typeof TEXTURE_SECTIONS[number]
