import type { Params } from '~/lib/spacetype/effect'
import type { Fill, FillsByRole } from '~/lib/texturefx/types'
import { activeFamily, legacyFill, rolesFor } from '~/lib/texturefx/roles'

export function defaultFill(color = '#7aa2f7'): Fill { return { type: 'solid', color } }

// Resolve a role's fill: explicit params.fills entry, else the legacy-color solid.
// Link fills are resolved recursively with cycle detection via _seen.
export function fillForRole(p: Params, roleKey: string, roleIndex: number, _seen: Set<string> = new Set()): Fill {
  const fills = (p as any).fills as FillsByRole | undefined
  const f = fills?.[roleKey]
  if (!f) return legacyFill(p, activeFamily(p), roleIndex)
  if (f.type === 'link') {
    const to = (f as any).to as string
    const roles = rolesFor(p)
    const ti = roles.indexOf(to)
    if (to === roleKey || ti < 0 || _seen.has(roleKey)) return legacyFill(p, activeFamily(p), roleIndex)
    _seen.add(roleKey)
    return fillForRole(p, to, ti, _seen)
  }
  return f
}

// Interpolate a multi-stop gradient at ramp position g in [0,1]. stops sorted by p.
// Mirrors the GLSL gradColor() function in renderer.ts -- both must stay in sync.
export function gradColorAt(stops: { c: string; p: number }[], g: number): [number, number, number] {
  if (!stops.length) return [0, 0, 0]
  if (stops.length === 1) return hexToRgb(stops[0]!.c)
  const s = [...stops].sort((a, b) => a.p - b.p)
  const gg = Math.min(s[s.length - 1]!.p, Math.max(s[0]!.p, g))
  for (let k = 0; k < s.length - 1; k++) {
    const a = s[k]!, b = s[k + 1]!
    if (gg >= a.p && gg <= b.p) {
      const t = b.p === a.p ? 0 : (gg - a.p) / (b.p - a.p)
      const ca = hexToRgb(a.c), cb = hexToRgb(b.c)
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]
    }
  }
  return hexToRgb(s[s.length - 1]!.c)
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
