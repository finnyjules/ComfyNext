import type { ElementV2 } from '../types'

/** House-style + placement gate for a generated element set. Off-grid regions
 *  and >3 distinct text sizes (SWISS_LIMITS.maxTypeSizes) are rejected so the
 *  orchestrator can re-roll. Colour count is enforced by construction (tiers
 *  bind to brand tokens), so it isn't re-checked here. */
export function validateGenerated(els: ElementV2[], cols: number, rows: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  for (const e of els) {
    const { col, colSpan, row, rowSpan } = e.region
    if (col < 1 || row < 1 || col + colSpan - 1 > cols || row + rowSpan - 1 > rows) {
      reasons.push(`off-grid: ${e.id}`)
    }
  }
  const levels = new Set(els.filter(e => e.type === 'text').map(e => (e as { level: string }).level))
  if (levels.size > 3) reasons.push(`too many type sizes: ${levels.size}`)
  return { ok: reasons.length === 0, reasons }
}
