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
import { applyArchetype, classifyFormat, fineGridDims, formatDims, gridDims, gridMetrics, gutterBox, marginBox, regionToRect, remapRegion, resolveFormat } from '~~/shared/template-grid'
import type { Rect } from '~~/shared/template-grid/grid'
import type { Archetype } from '~~/shared/template-grid/archetypes'
import { generate, shuffle, surprise } from '~~/shared/template-grid/generate/generate'
import { getTheme, resolveInk } from '~~/shared/template-grid/generate/themes'
import { appendTierItem, normalizeTiers } from '~~/shared/template-grid/generate/tiers'
import { deriveOutputs, type ResolvedLayout } from '~~/shared/template-grid/resolve'
import {
  addChildToStack, allElements, DEFAULT_AUTOLAYOUT, effectiveOrder, groupIntoSection, removeChildFromStack, sectionRegionFor,
  setChildSizing, setStackLayout, toV3, topLayer, ungroupSection, wrapInStack,
} from '~~/shared/template-grid/sections'
import { isLayoutStack, isV3 } from '~~/shared/template-grid/types'
import type {
  AnyGridTemplate, AutoLayout, ElementV2, ImageElementV2, OutputSpec, Region, SectionV3,
  ShapeElementV2, SizeMode, TemplateV2, TemplateV3, TextElementV2, TextStyleV2, TierId,
} from '~~/shared/template-grid/types'
import { defaultExpressiveBoxParams, type ExpressiveBoxParams } from '~~/shared/text-layout/boxes'

const WORST_CASE_COPY
  = 'A worst-case headline that runs far longer than anyone planned, stretching '
  + 'across the layout to stress-test wrapping, shrinking and truncation'

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

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
  // Armed by the Section tool → the next canvas drag draws a frame at that region.
  const frameDrawArmed = ref(false)
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
    allElements(template.value).find(e => e.id === selectedId.value) ?? null)

  const selectedResolved = computed(() =>
    resolved.value.elements.find(r => r.el.id === selectedId.value) ?? null)

  // Any layer — a top-level element OR a child inside a frame — so every edit
  // (style, region, hide/lock, nudge, duplicate) works on children too.
  function elById(id: string): ElementV2 | undefined {
    return allElements(template.value).find(e => e.id === id)
  }

  // -- Canvas zoom (shared: the canvas feeds container size + reads scale; the
  // shell renders the zoom toolbar). --------------------------------------
  const containerSize = ref({ w: 0, h: 0 })
  function setContainerSize(w: number, h: number) { containerSize.value = { w, h } }
  const zoomOverride = ref<number | null>(null)
  const fitScale = computed(() => {
    const f = format.value
    if (!containerSize.value.w || !containerSize.value.h || !f) return 1
    const padding = 64
    return Math.min((containerSize.value.w - padding) / f.w, (containerSize.value.h - padding) / f.h, 1)
  })
  const scale = computed(() => zoomOverride.value ?? fitScale.value)
  const isZoomFitted = computed(() => zoomOverride.value === null)
  function zoomBy(factor: number) {
    zoomOverride.value = Math.min(4, Math.max(0.05, (zoomOverride.value ?? fitScale.value) * factor))
  }
  function zoomFit() { zoomOverride.value = null }
  watch(currentFormat, () => { zoomOverride.value = null })   // reset to fit on format switch

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

  // -- Grid columns / rows (v3) ----------------------------------------------
  // How many columns and rows the canvas is divided into, fixed across every
  // format. Editing a count rescales every stored region on that axis so
  // nothing moves visually — only the placement granularity changes.

  const gridColumns = computed<number>(() => gridDims(template.value).cols)
  const gridRows = computed<number>(() => gridDims(template.value).rows)

  function rescaleGrid(next: { cols: number; rows: number }) {
    const cur = gridDims(template.value)
    if (next.cols === cur.cols && next.rows === cur.rows) return
    const from = cur
    const to = next
    const t = template.value as TemplateV3
    const remapOverrides = (ovr?: Record<string, { region?: Region; hidden?: boolean }>) => {
      if (!ovr) return
      for (const o of Object.values(ovr)) if (o?.region) o.region = remapRegion(o.region, from, to)
    }
    const remapByClass = (byClass?: Partial<Record<string, Region>>) => {
      if (!byClass) return
      for (const k of Object.keys(byClass)) {
        const r = byClass[k]
        if (r) byClass[k] = remapRegion(r, from, to)
      }
    }
    for (const el of allElements(t)) {
      el.region = remapRegion(el.region, from, to)
      remapByClass(el.regionByClass as any)
      remapOverrides(el.overrides)
    }
    for (const s of t.sections) {
      s.region = remapRegion(s.region, from, to)
      remapByClass(s.regionByClass as any)
      remapOverrides(s.overrides)
    }
    t.grid.columns = to.cols
    t.grid.rows = to.rows
    dirty.value = true
  }

  function setGridColumns(cols: number) {
    if (!isV3(template.value) || !Number.isFinite(cols)) return
    const cur = gridDims(template.value)
    rescaleGrid({ cols: Math.min(240, Math.max(1, Math.round(cols))), rows: cur.rows })
  }

  function setGridRows(rows: number) {
    if (!isV3(template.value) || !Number.isFinite(rows)) return
    const cur = gridDims(template.value)
    rescaleGrid({ cols: cur.cols, rows: Math.min(240, Math.max(1, Math.round(rows))) })
  }

  // -- Per-side margins ------------------------------------------------------
  // Resolved margins for the current template (uniform `grid.margin` fills any
  // side not explicitly set in `grid.margins`).
  const margins = computed(() => marginBox(template.value))

  function setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: number) {
    if (!Number.isFinite(value)) return
    const g = template.value.grid
    g.margins = { ...(g.margins ?? {}), [side]: Math.max(0, Math.round(value)) }
    dirty.value = true
  }

  // -- Per-axis gutter -------------------------------------------------------
  // Resolved gutters (uniform `grid.gutter` fills any axis not set in `grid.gutters`).
  const gutters = computed(() => gutterBox(template.value))

  function setGutter(axis: 'column' | 'row', value: number) {
    if (!Number.isFinite(value)) return
    const g = template.value.grid
    g.gutters = { ...(g.gutters ?? {}), [axis]: Math.max(0, Math.round(value)) }
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

  /** Set the document/canvas background fill (colour or CSS gradient) and/or
   *  image. Empty string clears a field; clearing both removes the background. */
  function setBackground(patch: { fill?: string; image?: string }) {
    const bg = (template.value.background ??= {})
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') delete (bg as Record<string, unknown>)[k]
      else (bg as Record<string, unknown>)[k] = v
    }
    if (!bg.fill && !bg.image) delete template.value.background
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

  // Per-output content override: swap an element's content for just the current
  // output (e.g. an outpainted image sized to this format). Same shape as
  // setHiddenInOutput, so it rides the deep-watch undo as one step.
  function hasContentOverride(id: string): boolean {
    return elById(id)?.overrides?.[currentOutputId.value]?.content != null
  }
  function setImageContentOverride(id: string, content: string) {
    const el = elById(id)
    if (!el) return
    el.overrides = { ...el.overrides, [currentOutputId.value]: { ...el.overrides?.[currentOutputId.value], content } }
    dirty.value = true
  }
  function clearImageContentOverride(id: string) {
    const el = elById(id)
    const ov = el?.overrides?.[currentOutputId.value]
    if (!ov || ov.content == null) return
    delete ov.content
    if (!Object.keys(ov).length) delete el!.overrides![currentOutputId.value]
    if (!Object.keys(el!.overrides!).length) delete el!.overrides
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

  /** A default placement region sized as a fraction of the master grid, so new
   * elements land sensibly whether the grid is coarse (v2) or fine (v3). Each
   * add nudges down-right a little so successive adds don't stack exactly. */
  function defaultRegion(fracW: number, fracH: number): Region {
    const mf = fineGridDims(template.value, template.value.formats[template.value.master])
    const colSpan = Math.max(1, Math.round(mf.cols * fracW))
    const rowSpan = Math.max(1, Math.round(mf.rows * fracH))
    const stagger = template.value.elements.length % 6
    const col = Math.min(mf.cols - colSpan + 1, Math.max(1, Math.round(mf.cols * 0.1) + stagger * Math.round(mf.cols * 0.04)))
    const row = Math.min(mf.rows - rowSpan + 1, Math.max(1, Math.round(mf.rows * 0.1) + stagger * Math.round(mf.rows * 0.04)))
    return { col, colSpan, row, rowSpan }
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
      region: defaultRegion(0.5, 0.1),
      style: { color: '#ffffff' },
    } satisfies TextElementV2)
  }

  function addImage(content = '') {
    addElement({
      id: uid('image'), type: 'image', priority: nextPriority(),
      content,
      focal: { x: 0.5, y: 0.5 },
      region: defaultRegion(0.5, 0.5),
      style: { fit: 'cover' },
    } satisfies ImageElementV2)
  }

  function addShape() {
    addElement({
      id: uid('shape'), type: 'shape', priority: nextPriority(),
      shape: 'rect',
      region: defaultRegion(0.25, 0.25),
      style: { fill: '#96b4ff55' },
    } satisfies ShapeElementV2)
  }

  function removeElement(id: string) {
    const idx = template.value.elements.findIndex(e => e.id === id)
    if (idx >= 0) {
      template.value.elements.splice(idx, 1)
    } else if (isV3(template.value)) {
      // A child inside a frame — remove it from that frame's children.
      for (const s of (template.value as TemplateV3).sections) {
        const ci = s.children.findIndex(c => c.id === id)
        if (ci >= 0) { s.children.splice(ci, 1); break }
      }
    }
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

  /** Move the selected element's region by whole cells. UNCLAMPED — dragging
   * or nudging an element past the canvas edge is allowed (Task 5's raw-region
   * -math engine support for `overhang`); it just sets `overhang: true` below
   * instead of snapping back in-bounds, and clears it once the element is
   * fully back inside. A generous sanity clamp (±2× the grid span, applied on
   * top of the old in-bounds bounds) still stops a runaway repeated nudge from
   * flying off to infinity. Region target follows the master/class rule via
   * setRegion. */
  function nudgeSelected(dCol: number, dRow: number) {
    const r = selectedResolved.value?.region
    if (!r || !selectedId.value) return
    const m = metrics.value
    const minCol = 1
    const maxCol = m.cols - r.colSpan + 1
    const minRow = 1
    const maxRow = m.rows - r.rowSpan + 1
    const col = Math.max(minCol - 2 * m.cols, Math.min(maxCol + 2 * m.cols, r.col + dCol))
    const row = Math.max(minRow - 2 * m.rows, Math.min(maxRow + 2 * m.rows, r.row + dRow))
    if (col === r.col && row === r.row) return
    setRegion(selectedId.value, { ...r, col, row })
    const el = elById(selectedId.value)
    if (!el) return
    const inBounds = col >= minCol && col <= maxCol && row >= minRow && row <= maxRow
    if (inBounds) {
      if (el.overhang) delete el.overhang
    } else {
      el.overhang = true
    }
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

  // -- Unified layer order (top-level z-order: elements AND sections) ----------
  // Reorders any top-level layer — an ungrouped element or a whole frame — in
  // the single `template.order` list (back → front). 'up' = toward the front.

  function moveLayerTo(id: string, targetIdx: number) {
    const cur = effectiveOrder(template.value)
    const from = cur.indexOf(id)
    if (from < 0) return
    const clamped = Math.max(0, Math.min(cur.length - 1, targetIdx))
    if (clamped === from) return
    cur.splice(from, 1)
    cur.splice(clamped, 0, id)
    template.value.order = cur
    dirty.value = true
  }

  function moveLayer(id: string, dir: 'up' | 'down') {
    const cur = effectiveOrder(template.value)
    const from = cur.indexOf(id)
    if (from < 0) return
    moveLayerTo(id, dir === 'up' ? from + 1 : from - 1)
  }

  // The selected TOP-LEVEL layer id (a frame or an ungrouped element) — z-order
  // ops only apply at the top level (children stack within their frame).
  function selectedTopLayerId(): string | null {
    if (selectedSectionId.value) return selectedSectionId.value
    const id = selectedId.value
    return id && template.value.elements.some(e => e.id === id) ? id : null
  }
  function bringForward() { const id = selectedTopLayerId(); if (id) moveLayer(id, 'up') }
  function sendBackward() { const id = selectedTopLayerId(); if (id) moveLayer(id, 'down') }
  function bringToFront() { const id = selectedTopLayerId(); if (id) moveLayerTo(id, effectiveOrder(template.value).length - 1) }
  function sendToBack() { const id = selectedTopLayerId(); if (id) moveLayerTo(id, 0) }

  // -- Copy / paste ------------------------------------------------------------
  const clipboard = ref<{ kind: 'element' | 'section'; data: any } | null>(null)

  function copySelected() {
    const secId = selectedSectionId.value
    if (secId && !selectedId.value && isV3(template.value)) {
      const s = (template.value as TemplateV3).sections.find(x => x.id === secId)
      if (s) clipboard.value = { kind: 'section', data: JSON.parse(JSON.stringify(s)) }
      return
    }
    const el = selectedElement.value
    if (el) clipboard.value = { kind: 'element', data: JSON.parse(JSON.stringify(el)) }
  }

  function offsetRegion(region: Region, dims: { cols: number; rows: number }): Region {
    return {
      ...region,
      col: Math.min(dims.cols - region.colSpan + 1, region.col + 1),
      row: Math.min(dims.rows - region.rowSpan + 1, region.row + 1),
    }
  }

  /** Paste the clipboard as a new layer (fresh ids, offset by a cell). A copied
   *  child pastes as a top-level element. */
  function pasteClipboard(): string | null {
    const c = clipboard.value
    if (!c) return null
    const dims = gridDims(template.value)
    if (c.kind === 'element') {
      const el = JSON.parse(JSON.stringify(c.data)) as ElementV2
      el.id = uid(el.type)
      el.region = offsetRegion(el.region, dims)
      delete (el as any).layoutSizing   // a pasted stack-child becomes free-floating
      addElement(el)
      return el.id
    }
    if (!isV3(template.value)) return null
    const t = template.value as TemplateV3
    const copy = JSON.parse(JSON.stringify(c.data)) as SectionV3
    copy.id = uid('section')
    copy.children = copy.children.map(ch => ({ ...ch, id: uid(ch.type) }))
    const moved = offsetRegion(copy.region, dims)
    const dCol = moved.col - copy.region.col
    const dRow = moved.row - copy.region.row
    copy.region = moved
    copy.children.forEach((ch) => { ch.region = { ...ch.region, col: ch.region.col + dCol, row: ch.region.row + dRow } })
    t.sections.push(copy)
    selectedSectionId.value = copy.id
    selectedId.value = null
    dirty.value = true
    return copy.id
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

  /** Nudge the selected section by whole grid cells (arrow keys). Uses the
   *  section's resolved region for the current format + setSectionRegion, so it
   *  writes to the right scope and carries children like a drag. */
  function nudgeSection(dCol: number, dRow: number) {
    const sid = selectedSectionId.value
    if (!sid) return
    const rs = resolvedSections.value.find(x => x.section.id === sid)
    if (!rs) return
    const m = metrics.value
    const r = rs.region
    const col = Math.min(m.cols - r.colSpan + 1, Math.max(1, r.col + dCol))
    const row = Math.min(m.rows - r.rowSpan + 1, Math.max(1, r.row + dRow))
    if (col === r.col && row === r.row) return
    setSectionRegion(sid, { ...r, col, row })
  }

  /** Duplicate a section (frame) + its children with fresh ids, offset by one
   *  cell. Selects the copy. */
  function duplicateSection(id: string): string | null {
    if (!isV3(template.value)) return null
    const t = template.value as TemplateV3
    const s = t.sections.find(x => x.id === id)
    if (!s) return null
    const dims = gridDims(t)
    const copy = JSON.parse(JSON.stringify(s)) as SectionV3
    copy.id = uid('section')
    copy.children = copy.children.map(c => ({ ...c, id: uid(c.type) }))
    const col = Math.min(dims.cols - copy.region.colSpan + 1, copy.region.col + 1)
    const row = Math.min(dims.rows - copy.region.rowSpan + 1, copy.region.row + 1)
    const dCol = col - s.region.col
    const dRow = row - s.region.row
    copy.region = { ...copy.region, col, row }
    copy.children.forEach((c) => { c.region = { ...c.region, col: c.region.col + dCol, row: c.region.row + dRow } })
    t.sections.push(copy)
    selectedSectionId.value = copy.id
    selectedId.value = null
    dirty.value = true
    return copy.id
  }

  /** Delete a section and its children. */
  function removeSection(id: string) {
    if (!isV3(template.value)) return
    const t = template.value as TemplateV3
    const idx = t.sections.findIndex(s => s.id === id)
    if (idx < 0) return
    t.sections.splice(idx, 1)
    if (selectedSectionId.value === id) selectedSectionId.value = null
    dirty.value = true
  }

  // -- Align (Figma) -----------------------------------------------------------

  function alignRegionIn(region: Region, edge: AlignEdge, b: { cStart: number; cEnd: number; rStart: number; rEnd: number }): Region {
    const r = { ...region }
    const cCols = b.cEnd - b.cStart + 1
    const cRows = b.rEnd - b.rStart + 1
    switch (edge) {
      case 'left':    r.col = b.cStart; break
      case 'right':   r.col = b.cEnd - r.colSpan + 1; break
      case 'hcenter': r.col = b.cStart + Math.round((cCols - r.colSpan) / 2); break
      case 'top':     r.row = b.rStart; break
      case 'bottom':  r.row = b.rEnd - r.rowSpan + 1; break
      case 'vcenter': r.row = b.rStart + Math.round((cRows - r.rowSpan) / 2); break
    }
    r.col = Math.max(b.cStart, Math.min(b.cEnd - r.colSpan + 1, r.col))
    r.row = Math.max(b.rStart, Math.min(b.rEnd - r.rowSpan + 1, r.row))
    return r
  }

  /** Align the selected layer within its container — the canvas grid for a
   *  top-level element/frame, or the parent frame for a child. */
  function alignSelected(edge: AlignEdge) {
    const dims = gridDims(template.value)
    const canvas = { cStart: 1, cEnd: dims.cols, rStart: 1, rEnd: dims.rows }
    const secId = selectedSectionId.value
    if (secId && !selectedId.value) {
      const rs = resolvedSections.value.find(x => x.section.id === secId)
      if (rs) setSectionRegion(secId, alignRegionIn(rs.region, edge, canvas))
      return
    }
    const id = selectedId.value
    if (!id) return
    const rr = selectedResolved.value
    if (!rr?.region) return
    let bounds = canvas
    if (isV3(template.value)) {
      const parent = resolvedSections.value.find(x => x.section.children.some(c => c.id === id))
      if (parent) {
        bounds = {
          cStart: parent.region.col, cEnd: parent.region.col + parent.region.colSpan - 1,
          rStart: parent.region.row, rEnd: parent.region.row + parent.region.rowSpan - 1,
        }
      }
    }
    setRegion(id, alignRegionIn(rr.region, edge, bounds))
  }

  /** Move/resize a section box. Scope mirrors setRegion: 'output' writes
   * overrides[oid], else master writes section.region and a non-master format
   * writes regionByClass[class]. */
  function setSectionRegion(id: string, region: Region) {
    const s = sectionById(id)
    if (!s) return
    if (regionScope.value === 'output') {
      s.overrides = { ...s.overrides, [currentOutputId.value]: { ...s.overrides?.[currentOutputId.value], region } }
    } else if (isMaster.value) {
      // A plain section positions its children by absolute master region, so a
      // MOVE (span unchanged) must carry them along — otherwise the box slides
      // out from under them. Auto-layout sections reflow children from the box
      // already, so they're left alone. Resize (span change) also leaves
      // children put (they reproject proportionally).
      if (!s.layout) {
        const dCol = region.col - s.region.col
        const dRow = region.row - s.region.row
        const moved = region.colSpan === s.region.colSpan && region.rowSpan === s.region.rowSpan && (dCol || dRow)
        if (moved) {
          for (const c of s.children) {
            c.region = { ...c.region, col: Math.max(1, c.region.col + dCol), row: Math.max(1, c.region.row + dRow) }
          }
        }
      }
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
    const v2 = template.value as TemplateV2
    // Fresh v3 defaults: a clean 16×16 grid with no gutter (a dense baseline
    // lattice would make any gutter negligible). Margin keeps the template's
    // uniform value (72 for the starter). Explicit counts are left alone.
    if (v2.grid.columns == null && v2.grid.rows == null) {
      v2.grid.columns = 16
      v2.grid.rows = 16
      v2.grid.gutter = 0
    }
    template.value = toV3(v2)
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

  // -- Auto-layout stacks -----------------------------------------------------

  /** Wrap elements (default: the current selectedId) into a new Stack section,
   * converting to v3 first if needed. Selects the new section. */
  function wrapSelectionInStack(ids?: string[]) {
    const targetIds = ids ?? (selectedId.value ? [selectedId.value] : [])
    if (!targetIds.length) return
    if (!isV3(template.value)) template.value = toV3(template.value as TemplateV2)
    const before = new Set((template.value as TemplateV3).sections.map(s => s.id))
    template.value = wrapInStack(template.value as TemplateV3, targetIds)
    const created = (template.value as TemplateV3).sections.find(s => !before.has(s.id))
    selectedSectionId.value = created?.id ?? null
    selectedId.value = null
    dirty.value = true
  }

  /** Patch the AutoLayout config of a stack section. */
  function updateStackLayout(sectionId: string, patch: Partial<AutoLayout>) {
    template.value = setStackLayout(template.value as TemplateV3, sectionId, patch)
    dirty.value = true
  }

  /** Update the main/cross sizing of a child element inside a stack. */
  function updateChildSizing(sectionId: string, childId: string, sizing: { main: SizeMode; cross: SizeMode }) {
    template.value = setChildSizing(template.value as TemplateV3, sectionId, childId, sizing)
    dirty.value = true
  }

  /** Move a top-level element into an existing stack section. */
  function moveChildIntoStack(sectionId: string, elementId: string) {
    template.value = addChildToStack(template.value as TemplateV3, sectionId, elementId)
    dirty.value = true
  }

  /** Remove a child from a stack section (returns it to top-level elements). */
  function moveChildOutOfStack(sectionId: string, childId: string) {
    template.value = removeChildFromStack(template.value as TemplateV3, sectionId, childId)
    dirty.value = true
  }

  /** The selected section if it is an auto-layout Stack, otherwise null. */
  const selectedStack = computed<SectionV3 | null>(() =>
    selectedSection.value && isLayoutStack(selectedSection.value) ? selectedSection.value : null)

  /** Set the frame appearance (fill / stroke / radius) of a section. */
  function setSectionStyle(sectionId: string, patch: Partial<NonNullable<SectionV3['style']>>) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    s.style = { ...(s.style ?? {}), ...patch }
    dirty.value = true
  }

  /** Rename any layer — an element (incl. a child) sets its display `name`. */
  function renameElement(id: string, name: string) {
    const el = elById(id)
    if (!el) return
    const trimmed = name.trim()
    if (trimmed) el.name = trimmed
    else delete el.name
    dirty.value = true
  }

  /** Rename a section (frame). */
  function renameSection(sectionId: string, name: string) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    const trimmed = name.trim()
    if (trimmed) s.name = trimmed
    dirty.value = true
  }

  /** Clip a section's children to its frame bounds (Figma frame behaviour). */
  function setSectionClip(sectionId: string, on: boolean) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    if (on) s.clip = true
    else delete s.clip
    dirty.value = true
  }

  /** Turn a section's auto-layout on (default vertical stack) or off. Turning
   *  it on clears expressive placement (the two are mutually exclusive). */
  function toggleSectionLayout(sectionId: string, on: boolean) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    if (on) { s.layout = JSON.parse(JSON.stringify(DEFAULT_AUTOLAYOUT)); delete s.expressive }
    else delete s.layout
    dirty.value = true
  }

  /** Turn a section's expressive placement on/off. On → default params and
   *  clears auto-layout (mutually exclusive). */
  function toggleSectionExpressive(sectionId: string, on: boolean) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    if (on) { s.expressive = defaultExpressiveBoxParams(); delete s.layout }
    else delete s.expressive
    dirty.value = true
  }

  /** Patch the expressive params of a section (merges onto current/default). */
  function setSectionExpressive(sectionId: string, patch: Partial<ExpressiveBoxParams>) {
    if (!isV3(template.value)) return
    const s = (template.value as TemplateV3).sections.find(x => x.id === sectionId)
    if (!s) return
    s.expressive = { ...(s.expressive ?? defaultExpressiveBoxParams()), ...patch }
    dirty.value = true
  }

  /** Create an empty frame at an explicit region (drawn on canvas). Does NOT
   *  clip by default — clipping is opt-in via the inspector, so a child that
   *  ends up outside the box (grouped/reparented) never silently vanishes.
   *  Selects it. */
  function addSectionAt(region: Region): string {
    if (!isV3(template.value)) template.value = toV3(template.value as TemplateV2)
    const t = template.value as TemplateV3
    const id = uid('section')
    t.sections.push({ id, name: 'Section', region: { ...region }, children: [] })
    selectedSectionId.value = id
    selectedId.value = null
    frameDrawArmed.value = false
    dirty.value = true
    return id
  }

  /** Wrap the selection into a plain frame Section (no auto-layout); with
   *  nothing selected, drop an empty frame. */
  function wrapSelectionInSection() {
    if (selectedId.value) groupSelectedInto('Section')
    else addSection('Section')
    // Clipping is opt-in (inspector toggle) so grouped children never vanish.
  }

  // -- Generation (staging × theme) --------------------------------------------
  // Deterministic re-generation from the axis tuple (Tasks 1–10's pure engine).
  // Every action commits its own history step immediately — `commit()` mirrors
  // the brief's `commit(next)` helper by assigning `template` then forcing an
  // undo checkpoint via the real `commitNow` (defined below; hoisted), so a
  // shuffle/surprise/etc. is always one atomic undo step, never merged into
  // the next debounced edit.

  const editorMode = ref<'layout' | 'freeform'>('layout')

  const genStaging = computed(() => (template.value as TemplateV3).gen?.staging ?? 'tower')
  const genTheme = computed(() => (template.value as TemplateV3).gen?.theme ?? 'paper')
  const genSeed = computed(() => (template.value as TemplateV3).gen?.seed ?? 1)
  const genLocks = computed(() => (template.value as TemplateV3).gen?.locks ?? {})
  const genAccentOnHero = computed(() => (template.value as TemplateV3).gen?.accentOnHero ?? false)

  function commit(next: TemplateV3) {
    template.value = next
    dirty.value = true
    commitNow()
  }

  function asV3(): TemplateV3 { convertToV3(); return template.value as TemplateV3 }
  // The first wired image (if any) threads through genCtx() for callers that
  // still need it; theme generation itself no longer consults it.
  function genCtx() {
    const img = (sampleProps.value?.image_layer_1 as string | undefined) || undefined
    return { brand: effectiveBrand.value as unknown as BrandKit, image: img }
  }

  function shuffleLayout() { commit(shuffle(asV3(), genCtx())) }
  function surpriseLayout() { commit(surprise(asV3(), genCtx())) }

  function setStaging(id: string) {
    const t = asV3()
    commit(generate(t, { staging: id, theme: t.gen?.theme ?? 'paper', seed: t.gen?.seed ?? 1, accentOnHero: t.gen?.accentOnHero, ...genCtx() }))
  }
  function setTheme(id: string) {
    const t = asV3()
    commit(generate(t, { staging: t.gen?.staging ?? 'tower', theme: id, seed: t.gen?.seed ?? 1, accentOnHero: t.gen?.accentOnHero, ...genCtx() }))
  }
  function toggleLock(axis: 'staging' | 'theme') {
    const t = asV3()
    const locks = { ...(t.gen?.locks ?? {}) }
    locks[axis] = !locks[axis]
    commit({ ...t, gen: { ...(t.gen ?? { staging: 'tower', theme: 'paper', seed: 1 }), locks } })
  }

  /** Toggle whether the hero tier reads in the theme's accent colour instead
   *  of the default ink. Regenerates with the same staging/theme/seed tuple
   *  — only the flag (stamped into `gen.accentOnHero`) changes. */
  function toggleAccentOnHero() {
    const t = asV3()
    const next = !(t.gen?.accentOnHero ?? false)
    commit(generate(t, {
      staging: t.gen?.staging ?? 'tower', theme: t.gen?.theme ?? 'paper', seed: t.gen?.seed ?? 1,
      accentOnHero: next, ...genCtx(),
    }))
  }

  /** Override (or, with `hex: null`, restore) one brand colour directly on the
   *  template, then regenerate with the same tuple so the luminance guard
   *  re-evaluates against the new value. Restoring reads the CURRENT theme's
   *  stamped value (field / resolveInk(field) / defaultAccent) — not the
   *  theme's default regardless of override, so it matches what a plain
   *  theme switch would have stamped. */
  function setBrandOverride(key: 'background' | 'foreground' | 'accent', hex: string | null) {
    const t = asV3()
    // A template with no prior generate() call has no `gen` at all — default
    // one (matching opts.theme below) so generate()'s stamp-on-change guard
    // sees a matching theme and doesn't treat this as a theme switch.
    const gen = t.gen ?? { staging: 'tower', theme: 'paper', seed: 1 }
    const theme = getTheme(gen.theme) ?? getTheme('paper')!
    const restored = key === 'background' ? theme.field
      : key === 'foreground' ? resolveInk(theme.field)
        : theme.defaultAccent
    // Also fill the OTHER two keys from the theme when they're missing (same
    // cold-start case): the stamp guard also fires when `brand` is missing
    // ANY of the three keys, which would still clobber the key we're setting
    // here even with a matching theme. A brand that already has a key keeps
    // its value — only the gaps are filled.
    const themeDefaults: BrandKit = { background: theme.field, foreground: resolveInk(theme.field), accent: theme.defaultAccent }
    const brand = { ...themeDefaults, ...(t.brand ?? {}), [key]: hex ?? restored }
    commit(generate({ ...t, brand, gen }, {
      staging: gen.staging, theme: gen.theme, seed: gen.seed,
      accentOnHero: gen.accentOnHero, ...genCtx(),
    }))
  }

  // Both helpers read/write item 0 of the tier's (normalized) list — single-
  // item behaviour preserved exactly; any further items ride along
  // untouched. Multi-item authoring UI is Task 3, not here.
  function tierType(id: TierId): Partial<TextStyleV2> {
    return normalizeTiers((template.value as TemplateV3).tiers)[id]?.[0]?.type ?? {}
  }
  function setTierType(id: TierId, patch: Partial<TextStyleV2>) {
    const t = asV3()
    const normalized = normalizeTiers(t.tiers)
    const items = normalized[id] ?? [{ content: '' }]
    const tiers = { ...normalized, [id]: [{ ...items[0], type: { ...items[0]?.type, ...patch } }, ...items.slice(1)] }
    // Re-generate in place so the type change is visible immediately (same tuple).
    commit(generate({ ...t, tiers }, { staging: t.gen?.staging ?? 'tower', theme: t.gen?.theme ?? 'paper', seed: t.gen?.seed ?? 1, accentOnHero: t.gen?.accentOnHero, ...genCtx() }))
  }
  /** Append a new item onto a tier's list (true append — earlier items are
   *  untouched, so "add another support line" no longer overwrites item 0;
   *  see appendTierItem). Regenerates with the same tuple. Returns the new
   *  item's index within the tier. */
  function addTierItem(id: TierId, content = ''): number {
    const t = asV3()
    const existing = normalizeTiers(t.tiers)[id] ?? []
    const tiers = appendTierItem(t.tiers ?? {}, id, { content: content || id.toUpperCase() })
    const seed = t.gen?.seed ?? 1
    commit(generate({ ...t, tiers }, { staging: t.gen?.staging ?? 'tower', theme: t.gen?.theme ?? 'paper', seed, accentOnHero: t.gen?.accentOnHero, ...genCtx() }))
    return existing.length
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
    setFormatDims, setGridSpec, gridColumns, gridRows, setGridColumns, setGridRows, margins, setMargin, gutters, setGutter, setBrand, setBackground, setRegion, setWorkingFormats,
    containerSize, setContainerSize, scale, fitScale, zoomOverride, isZoomFitted, zoomBy, zoomFit,
    regionScope, hasClassRegion, clearClassRegion, hasOutputOverride, clearOutputOverride,
    isHiddenInOutput, setHiddenInOutput,
    hasContentOverride, setImageContentOverride, clearImageContentOverride,
    loadTemplate, loadArchetype,
    patchElement, patchStyle,
    addText, addImage, addShape, removeElement, moveElement, moveElementTo, moveLayer, moveLayerTo,
    bringForward, sendBackward, bringToFront, sendToBack, duplicateSection, copySelected, pasteClipboard,
    toggleHidden, toggleLocked, isHidden, isLocked,
    duplicateElement, nudgeSelected, elById,
    isV3Mode, sections, selectedSectionId, selectedSection, resolvedSections,
    setSectionRegion, nudgeSection, removeSection, alignSelected, convertToV3, addSection, groupSelectedInto, ungroupSelectedSection,
    wrapSelectionInStack, updateStackLayout, updateChildSizing, moveChildIntoStack, moveChildOutOfStack, selectedStack,
    setSectionStyle, setSectionClip, renameSection, renameElement, toggleSectionLayout, wrapSelectionInSection, addSectionAt, frameDrawArmed,
    toggleSectionExpressive, setSectionExpressive,
    commitNow, undo, redo, canUndo, canRedo,
    editorMode, genStaging, genTheme, genSeed, genLocks, genAccentOnHero,
    setStaging, setTheme, toggleLock, toggleAccentOnHero, shuffleLayout, surpriseLayout, setBrandOverride,
    tierType, setTierType, addTierItem,
  }
}

export type GridEditorContext = ReturnType<typeof useGridEditor>
