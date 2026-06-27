/** v3 section helpers: lift a v2 template into v3, and group/ungroup elements
 * into named sections. Pure — every function returns a fresh template and never
 * mutates its input. The editor calls these on user actions. */

import type { ElementV2, Region, SectionV3, TemplateV2, TemplateV3 } from './types'

/** Lift a v2 template to v3: same elements, ungrouped, with an empty sections
 * array. Lossless — re-resolving matches the v2 result. */
export function toV3(t: TemplateV2): TemplateV3 {
  const { version: _v, ...rest } = t
  return { version: 3, ...structuredClone(rest), sections: [] }
}

/** Bounding region (1-based, inclusive spans) enclosing every member region. */
export function boundingRegion(regions: Region[]): Region {
  if (!regions.length) return { col: 1, colSpan: 1, row: 1, rowSpan: 1 }
  let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity
  for (const r of regions) {
    minCol = Math.min(minCol, r.col)
    minRow = Math.min(minRow, r.row)
    maxCol = Math.max(maxCol, r.col + r.colSpan - 1)
    maxRow = Math.max(maxRow, r.row + r.rowSpan - 1)
  }
  return { col: minCol, row: minRow, colSpan: maxCol - minCol + 1, rowSpan: maxRow - minRow + 1 }
}

let _sectionSeq = 0
function nextSectionId(): string {
  _sectionSeq += 1
  return `section-${_sectionSeq}`
}

/** Move the named ungrouped elements into a new section bounded by their
 * regions. Member order follows `elementIds`. */
export function groupIntoSection(t: TemplateV3, elementIds: string[], name: string): TemplateV3 {
  const ids = new Set(elementIds)
  const members: ElementV2[] = []
  for (const id of elementIds) {
    const el = t.elements.find(e => e.id === id)
    if (el) members.push(structuredClone(el))
  }
  if (!members.length) return t
  const section: SectionV3 = {
    id: nextSectionId(),
    name,
    region: boundingRegion(members.map(m => m.region)),
    children: members,
  }
  return {
    ...structuredClone(t),
    elements: t.elements.filter(e => !ids.has(e.id)).map(e => structuredClone(e)),
    sections: [...t.sections.map(s => structuredClone(s)), section],
  }
}

/** Inverse of groupIntoSection: a section's children return to ungrouped
 * elements (their regions are unchanged) and the section is removed. */
export function ungroupSection(t: TemplateV3, sectionId: string): TemplateV3 {
  const section = t.sections.find(s => s.id === sectionId)
  if (!section) return t
  return {
    ...structuredClone(t),
    elements: [
      ...t.elements.map(e => structuredClone(e)),
      ...section.children.map(c => structuredClone(c)),
    ],
    sections: t.sections.filter(s => s.id !== sectionId).map(s => structuredClone(s)),
  }
}
