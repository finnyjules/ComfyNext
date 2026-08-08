import type { ControlSpec, Params } from '../effect'
import { ringTransform, type TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'

const controls: ControlSpec[] = [
  { key: 'radius', label: 'Ring size', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon', showIf: { key: 'layout', equals: 'ring' } },
  { key: 'ringTilt', label: 'Ring tilt', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: -0.28, group: 'Transform', showIf: { key: 'layout', equals: 'ring' } },
  { key: 'ringOpening', label: 'Ring opening', kind: 'slider', min: -1, max: 1, step: 0.01, default: 0.55, group: 'Transform', showIf: { key: 'layout', equals: 'ring' } },
]

export const ringLayout: ShowcaseLayout = {
  id: 'ring',
  label: 'Ring',
  controls,
  place(i, n, p, t01): TileTransform {
    return ringTransform(i, n, {
      radius: Number(p.radius), ringTilt: Number(p.ringTilt), cardSize: Number(p.cardSize),
      speed: Number(p.speed), direction: String(p.direction) === 'ccw' ? -1 : 1,
    }, t01)
  },
  loopRates(p) { return [Math.max(1, Math.round(Number(p.speed) || 1))] },
}
