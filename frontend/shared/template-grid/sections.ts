/** v3 section helpers: lift a v2 template into v3, and group/ungroup elements
 * into named sections. Pure — every function returns a fresh template and never
 * mutates its input. The editor calls these on user actions. */

import { classifyFormat, fineGridDims, formatDims, remapRegion } from './grid'
import type { AnyGridTemplate, ElementV2, Region, SectionV3, TemplateV2, TemplateV3 } from './types'
import { isV3 } from './types'

/** The section box region for a target format/output, mirroring the resolver's
 * precedence: per-output override > per-class region > master region remapped
 * to the target fine grid. The single source of truth for both the resolver
 * and the editor (so the canvas section box matches the render). */
export function sectionRegionFor(
  template: AnyGridTemplate, section: SectionV3, formatKey: string, outputId?: string,
): Region {
  const f = template.formats[formatKey]
  const cls = classifyFormat(f)
  const oid = outputId ?? formatKey
  const masterFine = fineGridDims(template, template.formats[template.master])
  const targetFine = fineGridDims(template, f)
  return section.overrides?.[oid]?.region
    ?? section.regionByClass?.[cls]
    ?? remapRegion(section.region, masterFine, targetFine)
}

/** Every element a template renders: ungrouped top-level elements plus every
 * section child. Use wherever code needs to walk all content (fonts, tokens). */
export function allElements(t: AnyGridTemplate): ElementV2[] {
  if (!isV3(t)) return t.elements
  return [...t.elements, ...t.sections.flatMap(s => s.children)]
}

// JSON clone, not structuredClone — these templates are plain JSON and the
// editor passes Vue reactive proxies (which structuredClone can't clone).
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Lift a v2 template to v3: elements stay ungrouped, but their master
 * `region` is remapped from the v2 coarse class grid (e.g. 6×6) to the v3
 * baseline-derived fine grid (e.g. 78×78) so they keep the same proportions on
 * the canvas. Coarse per-class tweaks (`regionByClass`) and per-output region
 * overrides don't translate to the fine grid and are dropped; per-output
 * `hidden` flags are preserved. v3 re-derives cross-format placement from the
 * fine grid (and sections), so the stale coarse tweaks would be wrong anyway. */
export function toV3(t: TemplateV2): TemplateV3 {
  const { version: _v, ...rest } = clone(t)
  const v3: TemplateV3 = { version: 3, ...rest, sections: [] }
  const coarse = formatDims(v3.formats[v3.master])
  const fine = fineGridDims(v3, v3.formats[v3.master])
  v3.elements = v3.elements.map(el => migrateElementToFine(el, coarse, fine))
  return v3
}

/** Remap an element's master region coarse→fine; drop coarse per-class /
 * per-output region tweaks (keep per-output hidden). */
function migrateElementToFine(
  el: ElementV2, coarse: { cols: number; rows: number }, fine: { cols: number; rows: number },
): ElementV2 {
  const next: ElementV2 = { ...el, region: remapRegion(el.region, coarse, fine) }
  delete next.regionByClass
  if (next.overrides) {
    const kept: NonNullable<ElementV2['overrides']> = {}
    for (const [k, ov] of Object.entries(next.overrides)) {
      if (ov?.hidden != null) kept[k] = { hidden: ov.hidden }
    }
    if (Object.keys(kept).length) next.overrides = kept
    else delete next.overrides
  }
  return next
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
    if (el) members.push(clone(el))
  }
  if (!members.length) return t
  const section: SectionV3 = {
    id: nextSectionId(),
    name,
    region: boundingRegion(members.map(m => m.region)),
    children: members,
  }
  return {
    ...clone(t),
    elements: t.elements.filter(e => !ids.has(e.id)).map(e => clone(e)),
    sections: [...t.sections.map(s => clone(s)), section],
  }
}

/** Inverse of groupIntoSection: a section's children return to ungrouped
 * elements (their regions are unchanged) and the section is removed. */
export function ungroupSection(t: TemplateV3, sectionId: string): TemplateV3 {
  const section = t.sections.find(s => s.id === sectionId)
  if (!section) return t
  return {
    ...clone(t),
    elements: [
      ...t.elements.map(e => clone(e)),
      ...section.children.map(c => clone(c)),
    ],
    sections: t.sections.filter(s => s.id !== sectionId).map(s => clone(s)),
  }
}
