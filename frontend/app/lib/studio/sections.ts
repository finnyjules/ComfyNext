/**
 * Group a studio's controls into ordered inspector sections.
 *
 * The `order` array is BOTH the ordering and the allow-list: a control whose group
 * is not listed is dropped, matching texturefx/sections.ts's documented contract
 * ("any control whose group is not listed here is silently dropped"). Sections that
 * end up empty are omitted, so a studio never renders a blank card.
 */
export function groupIntoSections<T extends { group?: string }>(
  controls: T[],
  order: readonly string[],
  visible?: (c: T) => boolean,
): { title: string; controls: T[] }[] {
  const byGroup = new Map<string, T[]>()
  for (const c of controls) {
    if (visible && !visible(c)) continue
    const g = String(c.group ?? '')
    if (!order.includes(g)) continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(c)
  }
  return order
    .filter((g) => (byGroup.get(g)?.length ?? 0) > 0)
    .map((g) => ({ title: g, controls: byGroup.get(g)! }))
}
