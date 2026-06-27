/**
 * Reactive state for the v2 (Swiss grid) layout editor. The geometry twin of
 * useTemplateEditor: elements place by grid region, the canvas renders what
 * the shared resolver says (culling, copy fitting and all), and per-format
 * adjustments write `regionByClass` entries instead of per-aspect overrides.
 *
 * Editing semantics:
 *  - On the master format, edits write `el.region`.
 *  - On any other format, region edits write `el.regionByClass[class]` —
 *    one edit adjusts every format of that class.
 */
import { computed, ref, watch, type Ref } from 'vue'

import { effectiveBrand as mergeBrand } from '~~/shared/brand/resolve'
import type { BrandKit } from '~~/shared/brand/types'
import { applyArchetype, classifyFormat, fineGridDims, formatDims, gridMetrics, regionToRect, resolveFormat } from '~~/shared/template-grid'
import type { Rect } from '~~/shared/template-grid/grid'
import type { Archetype } from '~~/shared/template-grid/archetypes'
import { deriveOutputs, type ResolvedLayout } from '~~/shared/template-grid/resolve'
import {
  groupIntoSection, sectionRegionFor, toV3, ungroupSection,
} from '~~/shared/template-grid/sections'
import { isV3 } from '~~/shared/template-grid/types'
import type {
  AnyGridTemplate, ElementV2, ImageElementV2, OutputSpec, Region, SectionV3,
  ShapeElementV2, TemplateV2, TemplateV3, TextElementV2,
} from '~~/shared/template-grid/types'

const WORST_CASE_COPY
  = 'A worst-case headline that runs far longer than anyone planned, stretching '
  + 'across the layout to stress-test wrapping, shrinking and truncation'

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export function useGridEditor(
  initial: TemplateV2,
  opts?: { activeKit?: Ref<BrandKit | undefined>; aspects?: string },
) {
  // Ensure the template carries an explicit `outputs` list — migrate from the
  // node's `aspects` for pre-outputs templates so the rest of the editor can
  // assume outputs exist.
  if (!initial.outputs?.length) initial.outputs = deriveOutputs(initial, opts?.aspects)

  const template = ref<AnyGridTemplate>(initial)
  const currentOutputId = ref<string>(initial.outputs[0]?.id ?? initial.master)
  const selectedId = ref<string | null>(null)
  const selectedSectionId = ref<string | null>(null)
  const dirty = ref(false)
  const sampleProps = ref<Record<string, unknown>>({})
  const sampleBrand = ref<Record<string, unknown>>({})
  const worstCase = ref(false)

  const outputs = computed<OutputSpec[]>(() => template.value.outputs ?? [])
  const currentOutput = computed<OutputSpec | undefined>(() =>
    outputs.value.find(o => o.id === currentOutputId.value) ?? outputs.value[0])
  // The format key of the current output (drives all grid math / consumers).
  const currentFormat = computed<string>(() =>
    currentOutput.value?.format ?? (template.value.master in template.value.formats
      ? template.value.master
      : Object.keys(template.value.formats)[0]))

  const format = computed(() => template.value.formats[currentFormat.value])
  const formatClass = computed(() => classifyFormat(format.value))
  const isMaster = computed(() => currentFormat.value === template.value.master)
  const metrics = computed(() => gridMetrics(template.value, currentFormat.value))

  const effectiveProps = computed<Record<string, unknown>>(() => {
    if (!worstCase.value) return sampleProps.value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(sampleProps.value)) {
      out[k] = typeof v === 'string' && k.startsWith('text_layer_') ? WORST_CASE_COPY : v
    }
    return out
  })

  // What {{ brand.* }} resolves to in the editor: template defaults ← the
  // project's active kit ← any wired socket brand (sampleBrand) — the shared
  // merge, so the editor agrees with render precedence.
  const effectiveBrand = computed<Record<string, unknown>>(() =>
    mergeBrand(template.value.brand, opts?.activeKit?.value, sampleBrand.value as BrandKit))

  const resolved = computed<ResolvedLayout>(() =>
    resolveFormat(template.value, currentFormat.value, effectiveProps.value, effectiveBrand.value,
      { outputId: currentOutputId.value }))

  // One resolved layout per output (for the Outputs rail thumbnails + previews).
  const resolvedByOutput = computed<Array<{ output: OutputSpec; layout: ResolvedLayout }>>(() =>
    outputs.value.map(o => ({
      output: o,
      layout: resolveFormat(template.value, o.format, effectiveProps.value, effectiveBrand.value, { outputId: o.id }),
    })))

  const selectedElement = computed<ElementV2 | null>(() =>
    template.value.elements.find(e => e.id === selectedId.value) ?? null)

  const selectedResolved = computed(() =>
    resolved.value.elements.find(r => r.el.id === selectedId.value) ?? null)

  function elById(id: string): ElementV2 | undefined {
    return template.value.elements.find(e => e.id === id)
  }

  // -- Outputs (chosen deliverables) -----------------------------------------

  function selectOutput(id: string) {
    if (outputs.value.some(o => o.id === id)) {
      currentOutputId.value = id
      regionScope.value = 'class'   // don't carry per-output scope across outputs
    }
  }

  /** Add a deliverable for `format`. The same format may be added repeatedly
   * (variations); each gets a unique id. Returns the new output id. */
  function addOutput(format: string): string | null {
    if (!template.value.formats[format]) return null
    const id = uid('out')
    const label = template.value.formats[format]?.label
    ;(template.value.outputs ??= []).push({ id, format, label })
    currentOutputId.value = id
    regionScope.value = 'class'
    dirty.value = true
    return id
  }

  /** Duplicate an output into a variation: a fresh id right after the source,
   * copying its per-output overrides so it starts identical, then diverges. */
  function duplicateOutput(id: string): string | null {
    const list = template.value.outputs
    const idx = list?.findIndex(o => o.id === id) ?? -1
    if (!list || idx < 0) return null
    const src = list[idx]
    const newId = uid('out')
    const baseLabel = src.label ?? template.value.formats[src.format]?.label ?? src.format
    list.splice(idx + 1, 0, { id: newId, format: src.format, label: `${baseLabel} copy` })
    // Carry over this output's per-element overrides so the variation matches.
    for (const el of template.value.elements) {
      const ov = el.overrides?.[id]
      if (ov) el.overrides![newId] = JSON.parse(JSON.stringify(ov))
    }
    currentOutputId.value = newId
    regionScope.value = 'output'   // a duplicate is meant to diverge per-output
    dirty.value = true
    return newId
  }

  function removeOutput(id: string) {
    const list = template.value.outputs
    if (!list || list.length <= 1) return   // keep at least one deliverable
    const idx = list.findIndex(o => o.id === id)
    if (idx < 0) return
    list.splice(idx, 1)
    // Drop this output's per-element overrides.
    for (const el of template.value.elements) {
      if (el.overrides?.[id]) {
        delete el.overrides[id]
        if (!Object.keys(el.overrides).length) delete el.overrides
      }
    }
    if (currentOutputId.value === id) currentOutputId.value = list[Math.min(idx, list.length - 1)].id
    dirty.value = true
  }

  function renameOutput(id: string, label: string) {
    const o = template.value.outputs?.find(o => o.id === id)
    if (!o) return
    o.label = label.trim() || undefined
    dirty.value = true
  }

  /** Override (or reset, by passing undefined) a format's grid dimensions.
   * Clamped to 1–24; the class default applies when unset. */
  function setFormatDims(key: string, dims: { cols?: number | undefined; rows?: number | undefined }) {
    const f = template.value.formats[key]
    if (!f) return
    for (const k of ['cols', 'rows'] as const) {
      if (!(k in dims)) continue
      const v = dims[k]
      if (v == null) delete f[k]
      else f[k] = Math.min(24, Math.max(1, Math.round(v)))
    }
    dirty.value = true
  }

  /** Patch template-wide grid metrics (gutter/margin/baseline, master px). */
  function setGridSpec(patch: Partial<TemplateV2['grid']>) {
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        ;(template.value.grid as any)[k] = Math.max(0, Math.round(v))
      }
    }
    dirty.value = true
  }

  /** Set the formats (deliverables) the user is working on — the opening
   * format-picker choice. Rebuilds `outputs` (one per chosen format), picks a
   * master (1x1 if chosen, else the first), and points the editor at it.
   * Unknown keys are ignored; a no-op if none are valid. */
  function setWorkingFormats(keys: string[]) {
    const valid = keys.filter(k => k in template.value.formats)
    if (!valid.length) return
    const master = valid.includes('1x1') ? '1x1' : valid[0]
    template.value.master = master
    template.value.outputs = valid.map(k => ({ id: k, format: k, label: template.value.formats[k]?.label }))
    currentOutputId.value = template.value.outputs[0]!.id
    regionScope.value = 'class'
    dirty.value = true
  }

  /** Replace the working template wholesale (e.g. loading a saved template),
   * keeping the editor pointed at a valid format. */
  function loadTemplate(next: AnyGridTemplate) {
    template.value = JSON.parse(JSON.stringify(next))
    if (!template.value.formats[currentFormat.value]) {
      currentFormat.value = template.value.master in template.value.formats
        ? template.value.master
        : Object.keys(template.value.formats)[0]
    }
    selectedId.value = null
    dirty.value = true
    commitNow()
  }

  /** Apply an archetype's composition onto the current template (keeps the
   * format matrix + grid). Seeds editor-only placeholder copy for any unwired
   * text layer so the archetype reads as intended in the canvas. */
  function loadArchetype(arch: Archetype) {
    const placeholders: Record<string, string> = {
      text_layer_1: 'Headline goes here',
      text_layer_2: 'A supporting subhead line',
    }
    for (const [k, v] of Object.entries(placeholders)) {
      if (sampleProps.value[k] == null || sampleProps.value[k] === '') sampleProps.value[k] = v
    }
    loadTemplate(applyArchetype(template.value, arch))
  }

  /** Patch the template's brand kit. Empty-string values clear a key. */
  function setBrand(patch: Record<string, string | undefined>) {
    const brand = (template.value.brand ??= {})
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') delete (brand as any)[k]
      else (brand as any)[k] = v
    }
    if (!Object.keys(brand).length) delete template.value.brand
    dirty.value = true
  }

  // Where region edits land: 'class' (every format of this class via
  // regionByClass — or the base region when on the master) or 'output' (only
  // the current output, via overrides[outputId] — diverges a variation).
  // Reset to 'class' whenever the output changes.
  const regionScope = ref<'class' | 'output'>('class')

  function setRegion(id: string, region: Region) {
    const el = elById(id)
    if (!el) return
    if (regionScope.value === 'output') {
      el.overrides = { ...el.overrides, [currentOutputId.value]: { ...el.overrides?.[currentOutputId.value], region } }
    } else if (isMaster.value) {
      el.region = region
    } else {
      el.regionByClass = { ...el.regionByClass, [formatClass.value]: region }
    }
    dirty.value = true
  }

  function hasClassRegion(id: string): boolean {
    return elById(id)?.regionByClass?.[formatClass.value] != null
  }
  function hasOutputOverride(id: string): boolean {
    const ov = elById(id)?.overrides?.[currentOutputId.value]
    return ov?.region != null || ov?.hidden != null
  }

  function clearClassRegion(id: string) {
    const el = elById(id)
    if (!el?.regionByClass) return
    delete el.regionByClass[formatClass.value]
    if (!Object.keys(el.regionByClass).length) delete el.regionByClass
    dirty.value = true
  }
  function clearOutputOverride(id: string) {
    const el = elById(id)
    if (!el?.overrides?.[currentOutputId.value]) return
    delete el.overrides[currentOutputId.value]
    if (!Object.keys(el.overrides).length) delete el.overrides
    dirty.value = true
  }

  // Per-output visibility: hide an element in just the current output (vs the
  // global `hidden` toggled from the layers panel).
  function isHiddenInOutput(id: string): boolean {
    return elById(id)?.overrides?.[currentOutputId.value]?.hidden === true
  }
  function setHiddenInOutput(id: string, hidden: boolean) {
    const el = elById(id)
    if (!el) return
    if (hidden) {
      el.overrides = { ...el.overrides, [currentOutputId.value]: { ...el.overrides?.[currentOutputId.value], hidden: true } }
    } else if (el.overrides?.[currentOutputId.value]) {
      delete el.overrides[currentOutputId.value].hidden
      if (!Object.keys(el.overrides[currentOutputId.value]).length) delete el.overrides[currentOutputId.value]
      if (!Object.keys(el.overrides).length) delete el.overrides
    }
    dirty.value = true
  }

  function patchElement(id: string, patch: Partial<ElementV2>) {
    const el = elById(id)
    if (!el) return
    Object.assign(el, patch)
    dirty.value = true
  }

  function patchStyle(id: string, patch: Record<string, unknown>) {
    const el = elById(id)
    if (!el) return
    ;(el as any).style = { ...(el as any).style, ...patch }
    dirty.value = true
  }

  function nextPriority(): number {
    return Math.max(0, ...template.value.elements.map(e => e.priority)) + 1
  }

  function addElement(el: ElementV2) {
    template.value.elements.push(el)
    selectedId.value = el.id
    dirty.value = true
  }

  function addText() {
    addElement({
      id: uid('text'), type: 'text', priority: nextPriority(),
      level: 'body', content: 'New text',
      region: { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
      style: { color: '#ffffff' },
    } satisfies TextElementV2)
  }

  function addImage() {
    addElement({
      id: uid('image'), type: 'image', priority: nextPriority(),
      content: '',
      region: { col: 2, colSpan: 4, row: 2, rowSpan: 4 },
      style: { fit: 'cover' },
    } satisfies ImageElementV2)
  }

  function addShape() {
    addElement({
      id: uid('shape'), type: 'shape', priority: nextPriority(),
      shape: 'rect',
      region: { col: 1, colSpan: 2, row: 1, rowSpan: 2 },
      style: { fill: '#96b4ff55' },
    } satisfies ShapeElementV2)
  }

  function removeElement(id: string) {
    const idx = template.value.elements.findIndex(e => e.id === id)
    if (idx < 0) return
    template.value.elements.splice(idx, 1)
    if (selectedId.value === id) selectedId.value = null
    dirty.value = true
  }

  // -- Lock / hide ------------------------------------------------------------

  function toggleHidden(id: string) {
    const el = elById(id)
    if (!el) return
    if (el.hidden) delete el.hidden
    else el.hidden = true
    dirty.value = true
  }
  function toggleLocked(id: string) {
    const el = elById(id)
    if (!el) return
    if (el.locked) delete el.locked
    else el.locked = true
    dirty.value = true
  }
  function isHidden(id: string): boolean {
    return elById(id)?.hidden === true
  }
  function isLocked(id: string): boolean {
    return elById(id)?.locked === true
  }

  // -- Duplicate --------------------------------------------------------------

  /** Deep-clone an element with a fresh id, region shifted one cell down-right
   * (clamped to the master grid), and the next priority. Returns the new id. */
  function duplicateElement(id: string): string | null {
    const el = elById(id)
    if (!el) return null
    const masterDims = formatDims(template.value.formats[template.value.master])
    const r = el.region
    const region: Region = {
      col: Math.min(masterDims.cols - r.colSpan + 1, r.col + 1),
      row: Math.min(masterDims.rows - r.rowSpan + 1, r.row + 1),
      colSpan: r.colSpan,
      rowSpan: r.rowSpan,
    }
    const clone = {
      ...JSON.parse(JSON.stringify(el)),   // strip Vue proxy; elements are plain JSON
      id: uid(el.type),
      priority: nextPriority(),
      region,
    } as ElementV2
    delete (clone as any).role   // a duplicate isn't the wired layer
    template.value.elements.push(clone)
    selectedId.value = clone.id
    dirty.value = true
    return clone.id
  }

  // -- Nudge ------------------------------------------------------------------

  /** Move the selected element's region by whole cells (clamped). Region
   * target follows the master/class rule via setRegion. */
  function nudgeSelected(dCol: number, dRow: number) {
    const r = selectedResolved.value?.region
    if (!r || !selectedId.value) return
    const m = metrics.value
    const col = Math.min(m.cols - r.colSpan + 1, Math.max(1, r.col + dCol))
    const row = Math.min(m.rows - r.rowSpan + 1, Math.max(1, r.row + dRow))
    if (col === r.col && row === r.row) return
    setRegion(selectedId.value, { ...r, col, row })
  }

  // Array order is z-order (later = on top) — same contract as
  // useTemplateEditor so LayersPanel can be reused verbatim.
  function moveElementTo(id: string, targetIdx: number) {
    const idx = template.value.elements.findIndex(e => e.id === id)
    if (idx < 0) return
    const clamped = Math.max(0, Math.min(template.value.elements.length - 1, targetIdx))
    if (clamped === idx) return
    const [el] = template.value.elements.splice(idx, 1)
    template.value.elements.splice(clamped, 0, el)
    dirty.value = true
  }

  function moveElement(id: string, dir: 'up' | 'down') {
    const idx = template.value.elements.findIndex(e => e.id === id)
    if (idx < 0) return
    moveElementTo(id, dir === 'up' ? idx + 1 : idx - 1)
  }

  // -- v3 sections ------------------------------------------------------------
  // Sections are first-class draggable boxes in v3. Children ride their box
  // proportionally (resolved by the shared resolver), so section edits are the
  // only new interaction; all v2 element ops above keep working on
  // template.elements (ungrouped elements), which exists in both versions.

  const isV3Mode = computed(() => isV3(template.value))
  const sections = computed<SectionV3[]>(() => isV3(template.value) ? template.value.sections : [])
  const selectedSection = computed<SectionV3 | null>(() =>
    sections.value.find(s => s.id === selectedSectionId.value) ?? null)

  function sectionById(id: string): SectionV3 | undefined {
    return isV3(template.value) ? template.value.sections.find(s => s.id === id) : undefined
  }

  /** One box rect per section for the current format — what the canvas draws as
   * the section frame. Mirrors the resolver, so frame and render agree. */
  const resolvedSections = computed<Array<{ section: SectionV3; region: Region; rect: Rect; hidden: boolean }>>(() =>
    sections.value.map((s) => {
      const region = sectionRegionFor(template.value, s, currentFormat.value, currentOutputId.value)
      return {
        section: s,
        region,
        rect: regionToRect(region, metrics.value),
        hidden: s.hidden === true || s.overrides?.[currentOutputId.value]?.hidden === true,
      }
    }))

  /** Move/resize a section box. Scope mirrors setRegion: 'output' writes
   * overrides[oid], else master writes section.region and a non-master format
   * writes regionByClass[class]. */
  function setSectionRegion(id: string, region: Region) {
    const s = sectionById(id)
    if (!s) return
    if (regionScope.value === 'output') {
      s.overrides = { ...s.overrides, [currentOutputId.value]: { ...s.overrides?.[currentOutputId.value], region } }
    } else if (isMaster.value) {
      s.region = region
    } else {
      s.regionByClass = { ...s.regionByClass, [formatClass.value]: region }
    }
    dirty.value = true
  }

  /** Lift the working template to v3 (elements stay ungrouped) so sections can
   * be created. No-op if already v3. */
  function convertToV3() {
    if (isV3(template.value)) return
    template.value = toV3(template.value as TemplateV2)
    dirty.value = true
  }

  /** Group the given elements (default: the current selection) into a new named
   * section, converting to v3 first if needed. Selects the new section. */
  function groupSelectedInto(name: string, ids?: string[]) {
    const targetIds = ids ?? (selectedId.value ? [selectedId.value] : [])
    if (!targetIds.length) return
    if (!isV3(template.value)) template.value = toV3(template.value as TemplateV2)
    const before = new Set((template.value as TemplateV3).sections.map(s => s.id))
    template.value = groupIntoSection(template.value as TemplateV3, targetIds, name)
    const created = (template.value as TemplateV3).sections.find(s => !before.has(s.id))
    selectedId.value = null
    selectedSectionId.value = created?.id ?? null
    dirty.value = true
  }

  /** Create a fresh section (converting to v3 first if needed) with a default
   * box on the fine grid and one starter text child filling it, then select
   * it. The first-class "add a section" entry point. Returns the section id. */
  function addSection(name = 'Section'): string {
    if (!isV3(template.value)) template.value = toV3(template.value as TemplateV2)
    const t = template.value as TemplateV3
    const mf = fineGridDims(t, t.formats[t.master])
    const col = Math.max(1, Math.round(mf.cols * 0.12))
    const colSpan = Math.max(1, Math.min(mf.cols - col + 1, Math.round(mf.cols * 0.76)))
    const row = Math.max(1, Math.round(mf.rows * 0.55))
    const rowSpan = Math.max(1, Math.min(mf.rows - row + 1, Math.round(mf.rows * 0.28)))
    const region: Region = { col, colSpan, row, rowSpan }
    const id = uid('section')
    const child: TextElementV2 = {
      id: uid('text'), type: 'text', priority: nextPriority(),
      level: 'display', content: 'New section',
      region: { ...region },
      style: { color: '#ffffff' },
    }
    t.sections.push({ id, name, region, children: [child] })
    selectedSectionId.value = id
    selectedId.value = null
    dirty.value = true
    return id
  }

  /** Ungroup the selected section (or a given id): its children return to
   * ungrouped elements and the section is removed. */
  function ungroupSelectedSection(id?: string) {
    const sid = id ?? selectedSectionId.value
    if (!sid || !isV3(template.value)) return
    template.value = ungroupSection(template.value as TemplateV3, sid)
    if (selectedSectionId.value === sid) selectedSectionId.value = null
    dirty.value = true
  }

  // -- Undo / redo ------------------------------------------------------------
  // History holds JSON snapshots of `template`. `cursor` points at the entry
  // matching the last *committed* state; the live template may have drifted
  // ahead of it (uncommitted edits) until commitNow() captures them. A deep
  // watch debounces commits so a drag burst or rapid stepper edits collapse
  // into one history step.

  const HISTORY_CAP = 60
  const history = ref<string[]>([JSON.stringify(template.value)])
  const cursor = ref(0)
  let commitTimer: ReturnType<typeof setTimeout> | null = null

  const canUndo = computed(() => cursor.value > 0)
  const canRedo = computed(() => cursor.value < history.value.length - 1)

  function commitNow() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null }
    const snap = JSON.stringify(template.value)
    if (snap === history.value[cursor.value]) return
    const next = history.value.slice(0, cursor.value + 1)
    next.push(snap)
    while (next.length > HISTORY_CAP) next.shift()
    history.value = next
    cursor.value = next.length - 1
  }

  function scheduleCommit() {
    if (commitTimer) clearTimeout(commitTimer)
    commitTimer = setTimeout(commitNow, 350)
  }

  function restore(snap: string) {
    const parsed = JSON.parse(snap) as AnyGridTemplate
    template.value = parsed
    if (!parsed.outputs?.some(o => o.id === currentOutputId.value)) {
      currentOutputId.value = parsed.outputs?.[0]?.id ?? parsed.master
    }
    if (selectedId.value && !parsed.elements.some(e => e.id === selectedId.value)) {
      selectedId.value = null
    }
    if (selectedSectionId.value && isV3(parsed)
      && !parsed.sections.some(s => s.id === selectedSectionId.value)) {
      selectedSectionId.value = null
    }
  }

  function undo() {
    commitNow()                      // finalize any in-flight edit first
    if (cursor.value <= 0) return
    cursor.value--
    restore(history.value[cursor.value])
  }
  function redo() {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null }
    if (cursor.value >= history.value.length - 1) return
    cursor.value++
    restore(history.value[cursor.value])
  }

  // Auto-commit anything that mutates the template (drag, panel edits, adds).
  // Restores re-assign `template`, which also fires this — harmless: the
  // snapshot already equals history[cursor], so commitNow() no-ops.
  watch(template, scheduleCommit, { deep: true })

  return {
    template, currentFormat, currentOutputId, selectedId, dirty, sampleProps, sampleBrand, worstCase,
    format, formatClass, isMaster, metrics, resolved, resolvedByOutput, effectiveBrand,
    outputs, currentOutput,
    selectedElement, selectedResolved,
    selectOutput, addOutput, duplicateOutput, removeOutput, renameOutput,
    setFormatDims, setGridSpec, setBrand, setRegion, setWorkingFormats,
    regionScope, hasClassRegion, clearClassRegion, hasOutputOverride, clearOutputOverride,
    isHiddenInOutput, setHiddenInOutput,
    loadTemplate, loadArchetype,
    patchElement, patchStyle,
    addText, addImage, addShape, removeElement, moveElement, moveElementTo,
    toggleHidden, toggleLocked, isHidden, isLocked,
    duplicateElement, nudgeSelected,
    isV3Mode, sections, selectedSectionId, selectedSection, resolvedSections,
    setSectionRegion, convertToV3, addSection, groupSelectedInto, ungroupSelectedSection,
    commitNow, undo, redo, canUndo, canRedo,
  }
}

export type GridEditorContext = ReturnType<typeof useGridEditor>
