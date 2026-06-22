// SINGLE SOURCE OF TRUTH — any control whose `group` is not listed here is
// silently dropped from the panel. Guarded by texturefx-controls.unit.spec.ts.
// 'Cell' holds the content-mode picker; 'Content' (procedural) and 'Truchet'
// are shown contextually per mode; 'Output' is reserved for future export controls.
export const TEXTURE_SECTIONS = ['Lattice', 'Cell', 'Content', 'Truchet', 'Raster', 'Stylize', 'Color', 'Output'] as const
export type TextureSection = typeof TEXTURE_SECTIONS[number]
