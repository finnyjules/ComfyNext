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
import { computed, ref, watch } from 'vue'

import { applyArchetype, classifyFormat, formatDims, gridMetrics, resolveFormat } from '~~/shared/template-grid'
import type { Archetype } from '~~/shared/template-grid/archetypes'
import type { ResolvedLayout } from '~~/shared/template-grid/resolve'
import type {
  ElementV2, ImageElementV2, Region, ShapeElementV2, TemplateV2, TextElementV2,
} from '~~/shared/template-grid/types'

const WORST_CASE_COPY
  = 'A worst-case headline that runs far longer than anyone planned, stretching '
  + 'across the layout to stress-test wrapping, shrinking and truncation'

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export function useGridEditor(initial: TemplateV2) {
  const template = ref<TemplateV2>(initial)
  const currentFormat = ref<string>(initial.master in initial.formats
    ? initial.master
    : Object.keys(initial.formats)[0])
  const selectedId = ref<string | null>(null)
  const dirty = ref(false)
  const sampleProps = ref<Record<string, unknown>>({})
  const sampleBrand = ref<Record<string, unknown>>({})
  const worstCase = ref(false)

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

  // What {{ brand.* }} resolves to in the editor: the template's own brand kit
  // under any wired socket brand (sampleBrand) — same precedence as render.
  const effectiveBrand = computed<Record<string, unknown>>(() => ({
    ...(template.value.brand ?? {}),
    ...sampleBrand.value,
  }))

  const resolved = computed<ResolvedLayout>(() =>
    resolveFormat(template.value, currentFormat.value, effectiveProps.value, effectiveBrand.value))

  const resolvedAll = computed<Record<string, ResolvedLayout>>(() =>
    Object.fromEntries(Object.keys(template.value.formats).map(k =>
      [k, resolveFormat(template.value, k, effectiveProps.value, effectiveBrand.value)])))

  const selectedElement = computed<ElementV2 | null>(() =>
    template.value.elements.find(e => e.id === selectedId.value) ?? null)

  const selectedResolved = computed(() =>
    resolved.value.elements.find(r => r.el.id === selectedId.value) ?? null)

  function elById(id: string): ElementV2 | undefined {
    return template.value.elements.find(e => e.id === id)
  }

  function setFormat(key: string) {
    if (template.value.formats[key]) {
      currentFormat.value = key
      regionScope.value = 'class'   // don't carry the per-format scope across tabs
    }
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

  /** Replace the working template wholesale (e.g. loading a saved template),
   * keeping the editor pointed at a valid format. */
  function loadTemplate(next: TemplateV2) {
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

  // Where region edits on a non-master format land: 'class' (every format of
  // this class, regionByClass) or 'format' (only this exact format key,
  // overrides[key]). Reset to 'class' whenever the format changes.
  const regionScope = ref<'class' | 'format'>('class')

  function setRegion(id: string, region: Region) {
    const el = elById(id)
    if (!el) return
    if (isMaster.value) {
      el.region = region
    } else if (regionScope.value === 'format') {
      el.overrides = { ...el.overrides, [currentFormat.value]: { ...el.overrides?.[currentFormat.value], region } }
    } else {
      el.regionByClass = { ...el.regionByClass, [formatClass.value]: region }
    }
    dirty.value = true
  }

  function hasClassRegion(id: string): boolean {
    return elById(id)?.regionByClass?.[formatClass.value] != null
  }
  function hasFormatOverride(id: string): boolean {
    return elById(id)?.overrides?.[currentFormat.value]?.region != null
  }

  function clearClassRegion(id: string) {
    const el = elById(id)
    if (!el?.regionByClass) return
    delete el.regionByClass[formatClass.value]
    if (!Object.keys(el.regionByClass).length) delete el.regionByClass
    dirty.value = true
  }
  function clearFormatOverride(id: string) {
    const el = elById(id)
    const ov = el?.overrides?.[currentFormat.value]
    if (!ov) return
    delete ov.region
    if (!Object.keys(ov).length) delete el!.overrides![currentFormat.value]
    if (el!.overrides && !Object.keys(el!.overrides).length) delete el!.overrides
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
    const parsed = JSON.parse(snap) as TemplateV2
    template.value = parsed
    if (!parsed.formats[currentFormat.value]) {
      currentFormat.value = parsed.master in parsed.formats ? parsed.master : Object.keys(parsed.formats)[0]
    }
    if (selectedId.value && !parsed.elements.some(e => e.id === selectedId.value)) {
      selectedId.value = null
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
    template, currentFormat, selectedId, dirty, sampleProps, sampleBrand, worstCase,
    format, formatClass, isMaster, metrics, resolved, resolvedAll, effectiveBrand,
    selectedElement, selectedResolved,
    setFormat, setFormatDims, setGridSpec, setBrand, setRegion,
    regionScope, hasClassRegion, clearClassRegion, hasFormatOverride, clearFormatOverride,
    loadTemplate, loadArchetype,
    patchElement, patchStyle,
    addText, addImage, addShape, removeElement, moveElement, moveElementTo,
    toggleHidden, toggleLocked, isHidden, isLocked,
    duplicateElement, nudgeSelected,
    commitNow, undo, redo, canUndo, canRedo,
  }
}

export type GridEditorContext = ReturnType<typeof useGridEditor>
