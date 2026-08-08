import type { ControlSpec } from '../effect'
import type { TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'
const GA = Math.PI * (3 - Math.sqrt(5))
const pmod = (a: number, m: number) => ((a % m) + m) % m
const controls: ControlSpec[] = [
  { key: 'tunnelDepth', label: 'Tunnel depth', kind: 'slider', min: 5, max: 40, step: 0.5, default: 18, group: 'Ribbon', showIf: { key: 'layout', equals: 'tunnel' } },
  { key: 'tunnelSpread', label: 'Tunnel spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.5, group: 'Ribbon', showIf: { key: 'layout', equals: 'tunnel' } },
]
export const tunnelLayout: ShowcaseLayout = {
  id: 'tunnel', label: 'Card Tunnel', controls,
  place(i, n, p, t01): TileTransform {
    const depth = Number(p.tunnelDepth), spread = Number(p.tunnelSpread)
    const dir = String(p.direction) === 'ccw' ? -1 : 1
    const frac = pmod(i / Math.max(1, n) - dir * Math.round(Number(p.speed) || 0) * t01, 1)
    const a = i * GA
    return { x: Math.cos(a) * spread, y: Math.sin(a) * spread, z: -frac * depth, rotY: 0, scale: Number(p.cardSize) }
  },
  loopRates(p) { return [Math.max(1, Math.round(Number(p.speed) || 1))] },
}
