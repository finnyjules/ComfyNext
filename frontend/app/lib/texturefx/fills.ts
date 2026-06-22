import type { Params } from '~/lib/spacetype/effect'
import type { Fill, FillsByRole } from '~/lib/texturefx/types'
import { activeFamily, legacyFill } from '~/lib/texturefx/roles'

export function defaultFill(color = '#7aa2f7'): Fill { return { type: 'solid', color } }

// Resolve a role's fill: explicit params.fills entry, else the legacy-color solid.
export function fillForRole(p: Params, roleKey: string, roleIndex: number): Fill {
  const fills = (p as any).fills as FillsByRole | undefined
  const f = fills?.[roleKey]
  return f ?? legacyFill(p, activeFamily(p), roleIndex)
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Mirrors the GLSL evalFill tile-linear ramp in renderer.ts -- the two must stay in sync.
// Tile-global linear gradient coord is a MIRRORED ramp (0->1->0) so opposite tile
// edges match -> seamless. Direction snapped to integer wave numbers (8 directions)
// so ramp completes whole cycles per tile in each axis -- seamless at any angle.
// Cell-local is a plain ramp in cell coords. Returns 0..1.
export function gradientRampCoord(frame: string, fcx: number, fcy: number, ux: number, uy: number, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a), dy = Math.sin(a)
  if (frame === 'tile') {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    const kx = m > 0 ? Math.round(dx / m) : 1
    const ky = m > 0 ? Math.round(dy / m) : 0
    const t = ux * kx + uy * ky
    return 1 - Math.abs(2 * (t - Math.floor(t)) - 1)
  }
  const t = fcx * dx + fcy * dy
  return Math.min(1, Math.max(0, t))   // cell-local plain ramp
}
