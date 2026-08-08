import type { ElementV2 } from '../types'
import type { StagingResult } from './stagings'

/** True when two regions share at least one grid cell. */
function regionsOverlap(a: ElementV2['region'], b: ElementV2['region']): boolean {
  const ax2 = a.col + a.colSpan - 1, ay2 = a.row + a.rowSpan - 1
  const bx2 = b.col + b.colSpan - 1, by2 = b.row + b.rowSpan - 1
  return a.col <= bx2 && b.col <= ax2 && a.row <= by2 && b.row <= ay2
}

/** Declared-pair membership test, either ordering. */
function isDeclared(overlaps: Array<[string, string]> | undefined, aId: string, bId: string): boolean {
  if (!overlaps) return false
  return overlaps.some(([x, y]) => (x === aId && y === bId) || (x === bId && y === aId))
}

/** House-style + placement gate for a generated staging result. Off-grid
 *  regions, undeclared collisions, and >3 distinct text sizes
 *  (SWISS_LIMITS.maxTypeSizes) are rejected so the orchestrator can re-roll.
 *  A staging may DECLARE intended overlaps (`result.overlaps`, either
 *  ordering) — those pairs are exempt from the collision check. Colour
 *  count is enforced by construction (tiers bind to brand tokens), so it
 *  isn't re-checked here. */
export function validateGenerated(result: StagingResult, cols: number, rows: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const els = result.elements
  for (const e of els) {
    const { col, colSpan, row, rowSpan } = e.region
    if (col < 1 || row < 1 || col + colSpan - 1 > cols || row + rowSpan - 1 > rows) {
      reasons.push(`off-grid: ${e.id}`)
    }
  }
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i]!, b = els[j]!
      if (isDeclared(result.overlaps, a.id, b.id)) continue
      if (regionsOverlap(a.region, b.region)) {
        reasons.push(`overlap: ${a.id} + ${b.id}`)
      }
    }
  }
  const levels = new Set(els.filter(e => e.type === 'text').map(e => (e as { level: string }).level))
  if (levels.size > 3) reasons.push(`too many type sizes: ${levels.size}`)
  return { ok: reasons.length === 0, reasons }
}
