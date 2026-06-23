import type { Params } from '~/lib/spacetype/effect'
import type { Fill } from '~/lib/texturefx/types'

// Ordered roles per family. role 0 = primary ink, 1 = secondary, 2 = ground/gap.
// Procedural motifs: checker, stripes, dots, grid.
// Truchet tile families: arcs, diagonal, weave, multiscale.
export const ROLES_BY_FAMILY: Record<string, string[]> = {
  checker: ['a', 'b'], stripes: ['ink', 'ink2'], dots: ['dot', 'ground'], grid: ['line', 'ground'],
  arcs: ['stroke', 'ground'], diagonal: ['sideA', 'sideB'], weave: ['warp', 'weft', 'gap'], multiscale: ['arc', 'ground'],
  octagon: ['tile', 'joint'],
  pinwheel: ['a', 'b'],
  chevron: ['a', 'b'],
  basketweave: ['a', 'b'],
  herringbone: ['brickA', 'brickB'],
  fishscale: ['scaleA', 'scaleB', 'grout'],
  pythagorean: ['big', 'small'],
  hex: ['a', 'b', 'c'],
  cairo: ['a', 'b', 'c'],
  cubes: ['top', 'left', 'right'],
  weave3d: ['strandA', 'strandB', 'strandC'],
}

const PROCEDURAL_FAMILIES = new Set(['checker', 'stripes', 'dots', 'grid'])
const TRUCHET_FAMILIES = new Set(['arcs', 'diagonal', 'weave', 'multiscale'])
const SHAPE_FAMILIES = new Set(['octagon', 'pinwheel', 'chevron', 'basketweave', 'herringbone', 'fishscale', 'pythagorean', 'hex', 'cairo', 'cubes', 'weave3d'])

// Which family is active given the params (procedural motif, truchet tileFamily, …).
export function activeFamily(p: Params): string {
  if (String(p.mode) === 'truchet') return String(p.tileFamily)
  if (String(p.mode) === 'procedural') return String(p.motif)
  if (String(p.mode) === 'shapes') return String(p.shapeFamily)
  return 'checker' // raster mode has no roles; harmless default
}
export function rolesFor(p: Params): string[] {
  const mode = String(p.mode)
  const family = activeFamily(p)
  // Only return roles if the family is valid for the current mode — prevents truchet
  // families from being accidentally resolved in procedural mode and vice-versa.
  if (mode === 'truchet' && !TRUCHET_FAMILIES.has(family)) return ['a', 'b']
  if (mode === 'procedural' && !PROCEDURAL_FAMILIES.has(family)) return ['a', 'b']
  if (mode === 'shapes' && !SHAPE_FAMILIES.has(family)) return ['a', 'b']
  return ROLES_BY_FAMILY[family] ?? ['a', 'b']
}

// Legacy color a role index maps to, so existing tiles look identical pre-customization.
const GROUND_IS_BG = new Set(['dots', 'grid', 'arcs', 'multiscale'])
export function legacyColor(p: Params, family: string, roleIndex: number): string {
  // weave3d wants 3 light→dark strand tones over the dark Background recess, so it
  // reads as a 3D isometric weave out of the box (role2 must NOT default to bg).
  if (family === 'weave3d') return ['#d8dee9', '#9aa5b8', '#5b6472'][roleIndex] ?? '#5b6472'
  if (roleIndex === 0) return String(p.colorA ?? '#e8eef5')
  if (roleIndex === 2) return String(p.background ?? '#0e1116')
  // roleIndex 1
  return GROUND_IS_BG.has(family) ? String(p.background ?? '#0e1116') : String(p.colorB ?? '#7aa2f7')
}
export function legacyFill(p: Params, family: string, roleIndex: number): Fill {
  return { type: 'solid', color: legacyColor(p, family, roleIndex) }
}
