/**
 * geoshape colour-order — ranks items (clones or pieces) for palette assignment.
 * Pure arithmetic, dependency-light (same posture as arrange.ts): no paper/three.
 */
import type { GeoFillOrder } from './config'

export interface OrderItem { cx: number; cy: number; i: number }

/** rank[k] = the 0-based position of item k under `order`. Ties → original index. */
export function rankOrder(items: OrderItem[], order: GeoFillOrder, band: number): number[] {
  const n = items.length
  const idx = items.map((_, k) => k)
  if (order === 'created' || order === 'depth') return idx.slice()
  let mx = 0, my = 0
  for (const p of items) { mx += p.cx; my += p.cy }
  mx /= (n || 1); my /= (n || 1)
  const b = band > 1e-6 ? band : 1
  const key = (k: number): number => {
    const p = items[k]!
    switch (order) {
      case 'leftRight': return p.cx
      case 'topBottom': return p.cy
      case 'centerOut': return Math.hypot(p.cx - mx, p.cy - my)
      case 'around': return Math.atan2(p.cy - my, p.cx - mx)
      case 'rows': return Math.round(p.cy / b) * 1e6 + p.cx
      case 'columns': return Math.round(p.cx / b) * 1e6 + p.cy
      default: return p.i
    }
  }
  const sorted = idx.slice().sort((a, c) => (key(a) - key(c)) || (a - c))
  const rank = new Array<number>(n)
  sorted.forEach((s, r) => { rank[s] = r })
  return rank
}
