import type { ControlSpec } from '../effect'
import type { TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'
const controls: ControlSpec[] = [
  { key: 'gridCols', label: 'Columns', kind: 'slider', min: 1, max: 8, step: 1, default: 4, group: 'Ribbon', showIf: { key: 'layout', equals: 'grid' } },
  { key: 'gridGap', label: 'Grid gap', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0.2, group: 'Ribbon', showIf: { key: 'layout', equals: 'grid' } },
]
export const gridLayout: ShowcaseLayout = {
  id: 'grid', label: 'Grid', controls,
  place(i, n, p, _t01): TileTransform {
    const cols = Math.max(1, Math.round(Number(p.gridCols) || 1))
    const rows = Math.max(1, Math.ceil(Math.max(1, n) / cols))
    const gap = Number(p.cardSize) * (1 + Number(p.gridGap))
    const col = i % cols, row = Math.floor(i / cols)
    return { x: (col - (cols - 1) / 2) * gap, y: -(row - (rows - 1) / 2) * gap, z: 0, rotY: 0, scale: Number(p.cardSize) }
  },
  loopRates() { return [] },
}
