import type { ControlSpec, Params } from '../effect'
import type { TileTransform } from '../ringLayout'
import { ringLayout } from './ring'
import { sphereLayout } from './sphere'

export interface ShowcaseLayout {
  id: string; label: string; controls: ControlSpec[]
  place(i: number, n: number, p: Params, t01: number): TileTransform
  loopRates?(p: Params): number[]
}
export const SHOWCASE_LAYOUTS: ShowcaseLayout[] = [ringLayout, sphereLayout]
export function getLayout(id: string): ShowcaseLayout {
  const lc = String(id).toLowerCase()
  return SHOWCASE_LAYOUTS.find(l => l.id.toLowerCase() === lc) ?? SHOWCASE_LAYOUTS[0]!
}
