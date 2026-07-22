/**
 * Grouping for CatalogModal's opt-in sectioned grid. Pure so pickers (and
 * tests) can reason about grouping without mounting the modal. Section order
 * follows the declared list; items keep their incoming order within a
 * section; items whose section id isn't declared fall into a trailing
 * "Other" group; empty sections are dropped.
 */
export interface CatalogSection { id: string; label: string }

export function groupBySections<T>(
  items: T[],
  sections: CatalogSection[],
  sectionOf: (item: T) => string,
): { id: string; label: string; items: T[] }[] {
  const by = new Map<string, T[]>()
  for (const item of items) {
    const sid = sections.some(s => s.id === sectionOf(item)) ? sectionOf(item) : '__other'
    const list = by.get(sid) ?? []
    if (!list.length) by.set(sid, list)
    list.push(item)
  }
  const out = sections
    .filter(s => (by.get(s.id)?.length ?? 0) > 0)
    .map(s => ({ id: s.id, label: s.label, items: by.get(s.id)! }))
  const other = by.get('__other')
  if (other?.length) out.push({ id: '__other', label: 'Other', items: other })
  return out
}
