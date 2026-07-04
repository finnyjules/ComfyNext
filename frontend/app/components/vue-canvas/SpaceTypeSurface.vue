<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { getEffect } from '~/lib/spacetype/effects'
import { ensureBoostFont } from '~/lib/spacetype/effects/boost'
import { defaultsFromControls, type Params, type ControlSpec } from '~/lib/spacetype/effect'
import { SPACE_TYPE_SECTIONS } from '~/lib/spacetype/sections'
import { parseFills, serializeFills, FILL_TYPES, type Fill, type FillType } from '~/lib/spacetype/fills'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { DEFAULT_POST, type PostSettings } from '~/lib/spacetype/post'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { loopMultiplier } from '~/lib/spacetype/loop'
import { loadGoogleCatalog, googleFontCssUrl, googleAxisList, resolveFontFamily, fontHasWeightAxis, type GoogleFont } from '~/data/google-fonts'
import type { GradientStop } from '~/lib/spacetype/gradient'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import CurveEditor from '~/components/vue-canvas/CurveEditor.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StringPathEditor from '~/components/vue-canvas/StringPathEditor.vue'
import VibeControlBar from '~/components/vue-canvas/VibeControlBar.vue'
import SpaceTypeEffectGalleryModal from '~/components/vue-canvas/SpaceTypeEffectGalleryModal.vue'
import { useVibeControl } from '~/composables/useVibeControl'
import { loadSpaceDefaults, spaceDefaultFor, saveSpaceDefault } from '~/composables/useSpaceDefaults'
import { saveEffectThumbnail } from '~/composables/useEffectThumbnails'
import { SCENE_CONTENT_KEYS, type Scene } from '~/lib/spacetype/scene'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import BindableControlChip from '~/components/vue-canvas/studio/BindableControlChip.vue'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { controlKindToVariableType, type StudioControlDesc } from '~/lib/collection/studioBindables'
import { typeCompatible } from '~/lib/collection/bindables'
import { addSweepRows } from '~/lib/collection/model'
import { COLLECTION_PROP, VARS_TYPE, type CollectionColumn, type CollectionData } from '~/lib/collection/types'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'

const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills/videos as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

// Locate this node + its saved config blob on the canvas. The config lives at
// node.data.properties.comfynext_spaceType so it survives serialization
// (convertToLiteGraph stashes `properties`), letting the editor be reopened.
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

const fps = ref(30)
const FPS_OPTIONS = ['24', '30', '60']
const seamlessLoop = ref(false)
const DIMS: Record<string, [number, number]> = {
  '1920 × 1080 (16:9)': [1920, 1080],
  '1080 × 1920 (9:16)': [1080, 1920],
  '1080 × 1080 (1:1)': [1080, 1080],
  '1280 × 720 (16:9)': [1280, 720],
  '960 × 540 (16:9)': [960, 540],
}
const CUSTOM = 'Custom'
const dimsKey = ref('960 × 540 (16:9)')
const W = ref(960)
const H = ref(540)
// Editing W/H directly switches to Custom; clamp to an encodable range (even, 16–4096).
function onCustomDims() {
  const clamp = (v: number) => Math.max(16, Math.min(4096, Math.round((Number(v) || 16) / 2) * 2))
  W.value = clamp(W.value)
  H.value = clamp(H.value)
  dimsKey.value = CUSTOM
  engine?.setSize(W.value, H.value)
}
const effectId = ref('ribbon')
const effect = computed(() => getEffect(effectId.value))
const params = reactive<Params>(defaultsFromControls(effect.value.controls))

// Authoring tool: flip to false (or remove the button) once all effect thumbnails are captured.
const SHOW_THUMB_CAPTURE = true

const showEffectGallery = ref(false)
function onPickEffect(id: string) { effectId.value = id; showEffectGallery.value = false }

const { requestPatch } = useVibeControl()
const vibeBusy = ref(false)
const vibeProposal = ref<{ rationale: string; chips: { label: string; before: string; after: string; path: string }[] } | null>(null)
const vibeSnapshot = ref<Params | null>(null)
const vibeMoved = computed(() => new Set((vibeProposal.value?.chips ?? []).map(c => c.path)))

function fmt(v: unknown): string {
  return typeof v === 'number' ? Number(v).toFixed(2) : String(v)
}

async function onVibe(phrase: string) {
  vibeBusy.value = true
  try {
    const before: Params = { ...params }
    const { patch, rationale } = await requestPatch(effect.value.controls, params, effect.value.label, phrase)
    const keys = Object.keys(patch)
    if (!keys.length) { vibeProposal.value = null; return }
    vibeSnapshot.value = before
    const labelFor = (k: string) => effect.value.controls.find(c => c.key === k)?.label ?? k
    vibeProposal.value = {
      rationale,
      chips: keys.map(k => ({ path: k, label: labelFor(k), before: fmt(before[k]), after: fmt(patch[k]) })),
    }
    Object.assign(params, patch) // live preview updates via existing reactivity
  }
  catch (e: any) {
    vibeProposal.value = null
    console.error('[vibe]', e?.message || e)
    alert(e?.message || 'Vibe control failed. See console.')
  }
  finally {
    vibeBusy.value = false
  }
}

function onVibeKeep() { vibeProposal.value = null; vibeSnapshot.value = null }

function onVibeRevert() {
  if (vibeSnapshot.value && vibeProposal.value) {
    for (const chip of vibeProposal.value.chips) params[chip.path] = vibeSnapshot.value[chip.path]
  }
  vibeProposal.value = null
  vibeSnapshot.value = null
}

function onVibeFocus(path: string) {
  const el = document.querySelector(`[data-control-key="${path}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const loopDuration = ref(6)
const transparent = ref(false)
const bgColor = ref('#0e0e10')
const projection = ref<'perspective' | 'isometric'>('perspective')
// Shared post-processing (bloom / colour / chroma / lens blur) — applies to EVERY effect, live in
// the preview and in exports. Lives on the surface (global), persisted in the node config.
const post = reactive<PostSettings>({ ...DEFAULT_POST })
// Off-centre framing (−1…1 = half a frame each way). View-level like projection, so it lives
// outside the per-effect `params` (which gets wiped on effect switch).
const panX = ref(0)
const panY = ref(0)

// Multi-text rows: the `textList` control edits these; they're stored back into
// params.text as a newline-separated string (so ParamValue stays scalar). Editing a
// local reactive array keeps input focus/caret stable (vs re-deriving from a string).
const textLines = reactive<string[]>([''])
let syncingText = false
function pullTextLines() {
  syncingText = true
  const raw = String(params.text ?? '')
  const parts = raw.length ? raw.split('\n') : ['']
  textLines.splice(0, textLines.length, ...(parts.length ? parts : ['']))
  syncingText = false
}
watch(textLines, () => {
  if (syncingText) return
  const joined = textLines.join('\n')
  ;(params as Record<string, unknown>).text = joined
  onEdit('text', joined)
}, { deep: true })
function addTextRow() { textLines.push('') }
function removeTextRow(i: number) { textLines.splice(i, 1); if (!textLines.length) textLines.push('') }

// Fill rows for a `fillList` control (per-slot solid/gradient/grid/noise). Mirrors textLines:
// edit a local reactive array, sync back into the (scalar) param as a JSON string. `fillKey`
// is the control's key (effects have at most one fillList). FILL_TYPES is imported from fills.ts
// (single source of truth — keeps the dropdown in sync with the renderable types).
const fills = reactive<Fill[]>([])
let syncingFills = false
function fillKey(): string | null {
  return effect.value.controls.find(c => c.kind === 'fillList')?.key ?? null
}
function pullFills() {
  const k = fillKey()
  if (!k) return
  syncingFills = true
  const parsed = parseFills((params as Record<string, unknown>)[k])
  fills.splice(0, fills.length, ...parsed.map(f => ({ ...f })))
  syncingFills = false
}
watch(fills, () => {
  if (syncingFills) return
  const k = fillKey(); if (!k) return
  ;(params as Record<string, unknown>)[k] = serializeFills(fills)
}, { deep: true })
function addFill() { fills.push({ type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }) }
function removeFill(i: number) { fills.splice(i, 1); if (!fills.length) addFill() }
// Which controls each fill type actually uses (so the editor only shows relevant ones).
function fillNeedsB(f: Fill): boolean { return f.type !== 'solid' }                                  // second colour
function fillHasAngle(f: Fill): boolean { return f.type === 'ombre' || f.type === 'stripes' }        // direction
function fillHasDensity(f: Fill): boolean { return f.type === 'grid' || f.type === 'checkerboard' || f.type === 'stripes' || f.type === 'qr' }

// ── Drag-to-reorder for the text rows and fill cards (native DnD from a grip handle, so the
// row's inputs stay usable). `kind` keeps the two lists from cross-dropping onto each other.
const drag = reactive<{ kind: 'text' | 'fill' | null; from: number; over: number }>({ kind: null, from: -1, over: -1 })
function dragStart(kind: 'text' | 'fill', i: number, e: DragEvent) {
  drag.kind = kind; drag.from = i; drag.over = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))   // Firefox needs some data to start a drag
    const row = (e.target as HTMLElement).closest('[data-row]') as HTMLElement | null
    if (row) e.dataTransfer.setDragImage(row, 14, 14)
  }
}
function dragOver(kind: 'text' | 'fill', i: number, e: DragEvent) {
  if (drag.kind !== kind) return
  e.preventDefault()
  drag.over = i
}
function dropRow(kind: 'text' | 'fill', i: number) {
  if (drag.kind === kind && drag.from !== i && drag.from >= 0) {
    if (kind === 'text') { const [m] = textLines.splice(drag.from, 1); textLines.splice(i, 0, m!) }
    else { const [m] = fills.splice(drag.from, 1); fills.splice(i, 0, m!) }
  }
  dragEnd()
}
function dragEnd() { drag.kind = null; drag.from = -1; drag.over = -1 }

const canvas = ref<HTMLCanvasElement | null>(null)
let engine: SpaceTypeEngine | null = null
let raf = 0
// Unwrapped normalized loop-time (0..k). Spans k loops so fractional motion rates land on whole
// cycles before the wrap → the live preview seams just like the seamless export. k=1 (integer/no
// rates) keeps it in [0,1), identical to the old single-loop behavior.
let previewT01 = 0
let previewStart = 0
const baking = ref(false)
const renderError = ref<string | null>(null)
const webglOk = ref(true)

// Collapsible control sections. Effect controls declare their `group`; surface-only
// controls (gradient stops, loop, dimensions, transparent) are injected per section.
const SECTION_ORDER = SPACE_TYPE_SECTIONS
// Sections that should start collapsed; everything else starts open. 'Post' is a
// surface-injected section (not in SPACE_TYPE_SECTIONS) rendered as a standalone card.
const DEFAULT_COLLAPSED = new Set([
  'Layout', 'Skew', 'Warp', 'Stroke', 'Doodles', 'Shadow', 'Wave', 'Motion', 'Transform', 'Post', 'Output',
])
const openSections = reactive<Record<string, boolean>>(
  Object.fromEntries([...SPACE_TYPE_SECTIONS, 'Post'].map(name => [name, !DEFAULT_COLLAPSED.has(name)])),
)
const sections = computed(() =>
  SECTION_ORDER.map(name => ({ name, controls: effect.value.controls.filter(c => c.group === name) })),
)

/** A control may declare `showIf` to appear only when another param matches (e.g. a second axis's
 *  controls that only apply in a 'crosshatch' mode). Reactive via `params`. */
function controlIsVisible(c: ControlSpec): boolean {
  if (!c.showIf) return true
  const v = params[c.showIf.key]
  if (c.showIf.equals !== undefined) return v === c.showIf.equals
  if (c.showIf.notEquals !== undefined) return v !== c.showIf.notEquals
  return true
}

// Collections variable binding — Type Studio is the first surface to get promote/bind
// chips (collections Slice 2a, Task 5). `activeControls` maps the active effect's
// ControlSpec[] to the composable's StudioControlDesc shape; `applyParam` mirrors the
// structural-control write pattern (assign + rebuild) so a resolved preview value
// behaves exactly like a user edit for rebuild purposes.
// ControlSpec is a discriminated union (min/max/step/options only exist on some
// members) — read them via a loose cast rather than narrowing per-kind here.
function controlDesc(c: ControlSpec): StudioControlDesc {
  const any = c as any
  return { key: c.key, label: c.label, kind: c.kind, min: any.min, max: any.max, step: any.step, options: any.options }
}
function activeControls(): StudioControlDesc[] {
  return effect.value.controls.map(controlDesc)
}
const { boundColumnFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  activeControls,
  (key, value) => { (params as Record<string, unknown>)[key] = value; rebuild() },
  { nodes: () => props.nodes, edges: () => props.edges ?? [] },
)

// Wired collection lookup (studio -> collection, the inverse of wiredTargets) for the
// "Bind to" submenu — finds the Collection node feeding this studio's `vars` input.
const wiredColumns = computed<CollectionColumn[]>(() => {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((e: any) => String(e.target) === String(props.nodeId) && e?.data?.dataType === VARS_TYPE)
  if (!edge) return []
  const colNode = props.nodes.find((n: any) => String(n.id) === String(edge.source))
  const c = colNode?.data?.properties?.[COLLECTION_PROP]
  return c?.columns ?? []
})

// Wired collection NODE (not just its columns) — the sweep flow needs to
// mutate the actual CollectionData object once the popover's Apply fires.
function findWiredCollectionNode(): any | null {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((e: any) => String(e.target) === String(props.nodeId) && e?.data?.dataType === VARS_TYPE)
  if (!edge) return null
  return props.nodes.find((n: any) => String(n.id) === String(edge.source)) ?? null
}

// Sweep popover state — opened from the "Sweep…" chip menu item on a bound
// control; on Apply, turns the entered values into sweep rows on the wired
// collection and hands off to the drawer + a follow-up run event (mirrors
// Gradient Studio's applySweep, Slice 2a Task 8c).
const sweepPopover = ref<{ control: StudioControlDesc; anchor: { x: number; y: number } } | null>(null)
function applySweep(values: (string | number)[]) {
  const control = sweepPopover.value?.control
  sweepPopover.value = null
  if (!control) return
  const colNode = findWiredCollectionNode()
  const collection = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
  if (!colNode || !collection) return
  const columnKey = boundColumnFor(control.key)
  if (!columnKey) return

  const added = addSweepRows(collection, columnKey, values)
  window.dispatchEvent(new CustomEvent('comfynext:openCollection', { detail: { nodeId: String(colNode.id) } }))
  window.dispatchEvent(new CustomEvent('comfynext:runSweepRows', {
    detail: { collectionNodeId: String(colNode.id), rowIds: added.map(r => r.id), targetNodeId: props.nodeId },
  }))
}

const varMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
function openVarMenu(e: MouseEvent, c: ControlSpec) {
  const type = controlKindToVariableType(c.kind)
  if (type === null) return
  const desc = controlDesc(c)
  const liveValue = params[c.key] as string | number
  const bound = boundColumnFor(c.key)
  const items: MenuItem[] = []
  if (!bound) {
    items.push({ label: 'Turn into variable', action: () => promote(desc, liveValue) })
    const compatCols = wiredColumns.value.filter(col => typeCompatible(type, col.type))
    if (compatCols.length) {
      items.push({
        label: 'Bind to',
        children: compatCols.map(col => ({
          label: col.label,
          action: () => window.dispatchEvent(new CustomEvent('comfynext:bindControl', {
            detail: { nodeId: props.nodeId, path: `params.${c.key}`, columnKey: col.key },
          })),
        })),
      })
    }
  }
  else {
    items.push({
      label: 'Go to collection',
      action: () => {
        const edgeList = props.edges ?? []
        const edge = edgeList.find((ed: any) => String(ed.target) === String(props.nodeId) && ed?.data?.dataType === VARS_TYPE)
        if (edge) window.dispatchEvent(new CustomEvent('comfynext:openCollection', { detail: { nodeId: String(edge.source) } }))
      },
    })
    items.push({ label: 'Sweep…', action: () => { sweepPopover.value = { control: desc, anchor: { x: e.clientX, y: e.clientY } } } })
    items.push({ divider: true })
    items.push({ label: 'Unbind', action: () => unbind(c.key, liveValue) })
  }
  varMenu.value = { x: e.clientX, y: e.clientY, items }
}

const gradientStops = reactive<GradientStop[]>([
  { color: '#3b5bff', on: true },
  { color: '#ff3b3b', on: true },
  { color: '#ffd23b', on: true },
  { color: '#ffffff', on: false },
])

// Full Google Fonts catalog (~1900 families), fetched once via the shared proxy and
// used to populate the searchable font picker + decide weight-axis availability.
const fontCatalog = ref<GoogleFont[]>([])
loadGoogleCatalog().then((c) => { fontCatalog.value = c })

// Custom searchable font dropdown (a native <select> can't show 1900 options nicely,
// and a datalist has no visible affordance). Open/close + live filter, capped for perf.
const fontPickerOpen = ref(false)
const fontSearch = ref('')
const variableOnly = ref(false)
// A font is variable when it has a registered axis with an actual range (max > min).
const isVar = (f: GoogleFont) => f.axes.some(a => a.max > a.min)
const varAxes = (f: GoogleFont) => f.axes.filter(a => a.max > a.min).map(a => a.tag).join(' ')
const filteredFonts = computed(() => {
  const q = fontSearch.value.trim().toLowerCase()
  let list = fontCatalog.value
  if (variableOnly.value) list = list.filter(isVar)
  const matched = q ? list.filter(f => f.family.toLowerCase().includes(q)) : list
  return matched.slice(0, 120)
})
function selectFont(key: string, family: string) {
  ;(params as Record<string, unknown>)[key] = family
  fontPickerOpen.value = false
  fontSearch.value = ''
  onEdit(key, family)
}

// ✨ Describe-a-font search: type a description ("fonts like the Knicks logo"),
// an LLM suggests real Google families (grounded against fontCatalog), shown atop
// the literal list. Faces are loaded so each suggestion row previews in-face.
const { suggestions: fontSuggestions, loading: fontSuggestLoading, error: fontSuggestError, hasRun: fontSuggestRan, suggest: runFontSuggestApi, clear: clearFontSuggest } = useFontSuggest()
const { ensure: ensureFontFace } = useGoogleFontPreview()
function runFontSuggest() { runFontSuggestApi(fontSearch.value) }
watch(fontSuggestions, (list) => { for (const s of list) ensureFontFace(s.family) })
watch(fontSearch, () => { if (fontSuggestRan.value) clearFontSuggest() })
// Reset suggestions whenever the picker closes so a stale list doesn't reappear.
watch(fontPickerOpen, (open) => { if (!open && fontSuggestRan.value) clearFontSuggest() })
// Whether the currently-selected font has a continuous Weight axis (variable font).
// Drives the Type-weight slider's visibility (hidden for static families).
const fontIsVariable = computed(() => {
  void fontCatalog.value // re-evaluate once the catalog resolves
  return fontHasWeightAxis(resolveFontFamily(String(params.font)))
})

// Variable-font axes BEYOND weight (width / slant / optical-size / custom). Weight stays on
// the Type-weight slider; these are surfaced dynamically for the selected font and fed into
// the render via font-variation-settings (texOpts.axes → makeTextTexture / charLayout).
const fontAxes = reactive<Record<string, number>>({})
const varAxisList = computed(() => {
  void fontCatalog.value
  const f = fontCatalog.value.find(g => g.family === resolveFontFamily(String(params.font)))
  return f ? googleAxisList(f).filter(a => a.tag !== 'wght') : []
})
function syncFontAxes() {
  const keep = new Set(varAxisList.value.map(a => a.tag))
  for (const k of Object.keys(fontAxes)) if (!keep.has(k)) delete fontAxes[k]
  for (const a of varAxisList.value) if (!(a.tag in fontAxes)) fontAxes[a.tag] = a.default
}
watch(() => String(params.font), syncFontAxes)
watch(fontCatalog, syncFontAxes)
watch(fontAxes, () => rebuild(), { deep: true })

const loadedFontFamilies = new Set<string>()
async function ensureFont(value: string) {
  const family = resolveFontFamily(value)
  if (!loadedFontFamilies.has(family)) {
    const key = family.replace(/[^a-zA-Z0-9]/g, '_')
    if (!document.querySelector(`link[data-stg-font="${key}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = googleFontCssUrl(family); link.setAttribute('data-stg-font', key)
      document.head.appendChild(link)
    }
    loadedFontFamilies.add(family)
  }
  try { await document.fonts.load(`700 32px "${family}"`) } catch { /* best-effort */ }
}

// Boost needs the font's vector OUTLINE (via fontkit), not just the CSS face. Preload it
// before rebuild so buildScene has the glyph shapes; never throws (falls back internally).
async function ensureEffectFonts() {
  await ensureFont(String(params.font))
  if (effectId.value === 'boost') { try { await ensureBoostFont(String(params.font)) } catch { /* fallback */ } }
}

function texOpts() {
  const family = resolveFontFamily(String(params.font))
  // Static families have no weight axis — pin to 400 so we don't faux-bold a single cut.
  const weight = fontHasWeightAxis(family) ? Number(params.typeWeight ?? 700) : 400
  // Multiple texts (one per line) → an N-row atlas the effect alternates between.
  // Only effects that DECLARE a `textList` control are multi-text-aware; others collapse
  // to the first text so an unwired effect never renders a stacked atlas by mistake.
  const multiAware = effect.value.controls.some(c => c.kind === 'textList')
  const rawTexts = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
  const texts = rawTexts.length ? rawTexts : ['']
  // Coil/elastic/echo size to their own text (no tiling), so they take the RAW uppercased
  // word with NO trailing-gap pad — otherwise the gap is dead space that throws off centering.
  // Tiling effects (ribbon/stripes/field) keep buildRibbonLabel's trailing gap so repeated
  // text has space between copies.
  const rawWords = effectId.value === 'coil' || effectId.value === 'elastic' || effectId.value === 'echo'
  // Effects may opt out of the suite's force-uppercase default by declaring a `textCase` control
  // set to 'asis'; everything else stays uppercase (backwards compatible).
  const asis = String(params.textCase ?? 'upper') === 'asis'
  const caseMode = asis ? 'as-typed' : 'upper'
  const cased = (t: string) => (asis ? t : t.toUpperCase())
  const labels = multiAware
    ? texts.map(t => (rawWords ? cased(t) : buildRibbonLabel(t, caseMode)))
    : [rawWords ? cased(texts[0] ?? '') : buildRibbonLabel(texts[0] ?? '', caseMode)]
  // Slit Scan renders on a single flat quad that FILLS the frame and stretches the glyphs, so it
  // magnifies the text far beyond the default ~256px atlas → blur. Supersample its atlas (scale the
  // glyph AND the row together so the ink proportions — and thus the look — are unchanged, just
  // higher-res). Other effects keep the default resolution.
  // Supersample the text atlas 2× so glyph edges stay crisp in the authoring preview when
  // magnified onto large bands (slit-scan needs even more — it fills the frame with one quad).
  // Corner Pin stretches ONE word across each full-width band (poster scale), so the source atlas
  // must out-resolve the on-screen glyph or the magnified ends go soft. Push it high for few bands
  // (each band is huge) and scale down as bands multiply (each band shrinks → less magnification),
  // keeping the atlas height bounded (256·SS·N ≈ ≤ 3k) so it never blows the GPU texture cap.
  const cpSS = texts.length <= 2 ? 5 : texts.length === 3 ? 4 : texts.length <= 5 ? 3 : 2
  const atlasSS = effectId.value === 'cornerpin' ? cpSS : effectId.value === 'slitscan' ? 3 : 2
  return {
    label: labels[0]!,
    labels,
    fontFamily: family,
    // STG-style names (typeWeight/typeYScale/typeXScale) with fallbacks so effects
    // that still use typeHeight keep working unchanged.
    fontWeight: weight,
    axes: { wght: weight, ...fontAxes },
    typeColor: String(params.typeColor),
    fontSizePx: Number(params.typeYScale ?? params.typeHeight ?? 180) * atlasSS,
    heightPx: 256 * atlasSS,
    scaleX: Number(params.typeXScale ?? 1),
    tracking: Number(params.tracking),
    strokeColor: '#000000',
    strokeWidth: Number(params.typeStroke),
    gradientStops: gradientStops.map(s => ({ ...s })),
    gradientOn: String(params.gradientMode) === 'on',
    uRepeat: Number(params.textRepeat),
  }
}

function rebuild() {
  previewT01 = 0
  engine?.build(params, texOpts())
}

// Structural edits (geometry/material/texture) are expensive (dispose + rebuild + text
// raster), so coalesce multiple param changes in the same tick into ONE rebuild — but on the
// NEXT ANIMATION FRAME, not a trailing setTimeout. A trailing debounce only fired after the
// drag paused, so the preview stopped tracking a slider mid-drag (stutter); rAF coalescing
// rebuilds once per frame while dragging, so the preview follows the slider continuously.
let rebuildRaf = 0
// The sweep baker (renderBlobWithOverrides) owns rebuilds while baking — see
// renderBlobWithOverrides. It writes overrides straight onto `params`, which
// would otherwise also trip the structuralSignature watch below and queue an
// uncoordinated second rebuild via rAF that could land mid-bake or clobber the
// baker's own capture/restore sequence.
let bakingOverrides = false
function scheduleRebuild() {
  if (bakingOverrides) return // the sweep baker owns rebuilds while baking — see renderBlobWithOverrides
  if (rebuildRaf) return
  rebuildRaf = requestAnimationFrame(async () => {
    rebuildRaf = 0
    await ensureEffectFonts()
    rebuild()
  })
}

function startPreview() {
  // Drive the preview by REAL elapsed time at the intended FPS, not one frame
  // per repaint — otherwise playback runs at the display refresh rate (~2x on
  // 60Hz, ~4x on 120Hz) and faster than the baked export. The rAF timestamp
  // keeps it frame-rate independent and matched to what export produces.
  previewStart = 0
  const tick = (ts: number) => {
    if (!previewStart) previewStart = ts
    // Extend the loop to k loops so fractional spin/wave rates seam at the wrap (same logic the
    // seamless export uses). Unwrapped t01 = frame / base runs 0..k; renderFrameAt keeps motions
    // at their per-loop rate across loops instead of re-wrapping each loop (which caused the jump).
    const base = Math.max(1, Math.round(fps.value * loopDuration.value))
    const k = loopMultiplier(effect.value.loopRates?.(params) ?? [])
    const frame = Math.floor(((ts - previewStart) / 1000) * fps.value) % (base * k)
    previewT01 = frame / base
    engine?.renderFrameAt(previewT01, params)
    renderError.value = engine?.lastError ?? null
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function stopPreview() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

// True only while loadConfig() is restoring a saved blob. Setting effectId fires
// the effectId watcher one tick LATER, and that watcher resets params to the new
// effect's defaults — which would wipe the scene we just restored on reopen. The
// guard makes the watcher skip that reset during hydration (onMounted already
// builds the engine with the restored effect + params).
let hydrating = false

// Hydrate local editor state from a previously-saved config blob, so reopening
// the editor on an existing node restores exactly what the user last authored.
function loadConfig() {
  const n = currentNode()
  const c = n?.data?.properties?.comfynext_spaceType
  if (!c) return // first edit of a fresh node — keep the defaults.
  hydrating = true
  // Restore effectId BEFORE params so the engine builds with the right effect
  // and the control panel (sections) reflects the saved effect's controls.
  // Normalize to the resolved effect's canonical id so a config saved under an old mixed-case id
  // (e.g. 'cornerPin') resolves AND the buttons (thumbnail/default save) send a backend-valid id.
  if (typeof c.effectId === 'string') effectId.value = getEffect(c.effectId).id
  if (c.params && typeof c.params === 'object') Object.assign(params, c.params)
  if (Array.isArray(c.gradientStops)) {
    gradientStops.splice(0, gradientStops.length, ...c.gradientStops.map((s: any) => ({ ...s })))
  }
  if (c.post && typeof c.post === 'object') Object.assign(post, c.post)
  if (typeof c.fps === 'number') fps.value = c.fps
  if (typeof c.loopDuration === 'number') loopDuration.value = c.loopDuration
  if (typeof c.transparent === 'boolean') transparent.value = c.transparent
  if (typeof c.bgColor === 'string') bgColor.value = c.bgColor
  if (c.projection === 'perspective' || c.projection === 'isometric') projection.value = c.projection
  if (typeof c.panX === 'number') panX.value = c.panX
  if (typeof c.panY === 'number') panY.value = c.panY
  if (typeof c.dimsKey === 'string') {
    dimsKey.value = c.dimsKey
    const d = DIMS[c.dimsKey]
    if (d) { W.value = d[0]; H.value = d[1] }
  }
  // Explicit W/H override the preset (restores Custom dimensions).
  if (typeof c.W === 'number' && typeof c.H === 'number') { W.value = c.W; H.value = c.H }
  // Fallback clear: if the saved effect equals the current one, the effectId
  // watcher never fires (so it can't self-clear the flag) — release it next tick.
  nextTick(() => { hydrating = false })
}

// Persist the full current editor state back onto the node's properties so the
// config survives tab switches / reloads and the editor can be reopened to edit.
function saveConfig() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  const prev = n.data.properties.comfynext_spaceType || {}
  n.data.properties.comfynext_spaceType = {
    ...prev,
    effectId: effectId.value,
    params: { ...params },
    gradientStops: gradientStops.map(s => ({ ...s })),
    post: { ...post },
    fps: fps.value, loopDuration: loopDuration.value,
    dimsKey: dimsKey.value, W: W.value, H: H.value, transparent: transparent.value, bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value, panY: panY.value,
  }
}

function closeEditor() { saveConfig(); emit('close') }

onMounted(async () => {
  if (!canvas.value) return
  // Restore saved config BEFORE building the engine so the first render is
  // already the user's authored state (not the defaults).
  const hadConfig = !!currentNode()?.data?.properties?.comfynext_spaceType
  loadConfig()
  pullTextLines()
  pullFills()
  await loadSpaceDefaults()
  if (!hadConfig) { const sc = spaceDefaultFor(effectId.value); if (sc) applyDefaultScene(sc) }
  if (!detectWebGL()) { webglOk.value = false; return }
  engine = new SpaceTypeEngine(canvas.value, {
    effect: effect.value, width: W.value, height: H.value, fps: fps.value, loopDuration: loopDuration.value,
    alpha: transparent.value, bgColor: bgColor.value, projection: projection.value,
    panX: panX.value, panY: panY.value,
  })
  engine.setPost({ ...post })
  await ensureEffectFonts()
  rebuild()
  startPreview()
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
})

onBeforeUnmount(() => {
  saveConfig(); if (rebuildRaf) cancelAnimationFrame(rebuildRaf); stopPreview(); engine?.dispose(); engine = null
  unregisterStudioParamBaker(props.nodeId)
})

// Global view keys are live for every effect (camera/scene transform read per frame).
const GLOBAL_LIVE_KEYS = ['speed', 'scale', 'rotateX', 'rotateY', 'rotateZ']
function structuralSignature(): string {
  const live = new Set([...GLOBAL_LIVE_KEYS, ...(effect.value.liveKeys ?? [])])
  const sig: Record<string, unknown> = {}
  for (const k of Object.keys(params)) sig[k] = live.has(k) ? 0 : params[k]
  return JSON.stringify(sig) + JSON.stringify(gradientStops)
}
watch(structuralSignature, () => { scheduleRebuild() })
// Switching effect: reset params to the new effect's defaults, but carry over any
// param values the two effects share (text/font/typeColor/etc.) so they persist
// across the switch. Then point the engine at the new effect and rebuild.
// Only CONTENT carries across an effect switch (the text + font you're working on). Everything
// else — geometry, fills, colours, AND framing (scale/rotation) — resets to the NEW effect's own
// defaults: those are tuned per effect, so carrying e.g. another effect's rotation flattens the
// new one edge-on (Ribbon wants its −0.5 tilt; Coil sits at 0).
const CARRY_ON_SWITCH = new Set(['text', 'font'])
// Apply a saved default scene onto the live editor refs (used on fresh open / effect switch / reset).
function applyDefaultScene(scene: Scene) {
  // A scene captures the LOOK, not the content — keep the current text/font (so switching to a
  // defaulted effect doesn't replace the words you're working on).
  const keep: Record<string, any> = {}
  for (const k of SCENE_CONTENT_KEYS) if (k in params) keep[k] = (params as any)[k]
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, scene.params)
  for (const k of SCENE_CONTENT_KEYS) {
    if (k in keep) (params as any)[k] = keep[k]
    else delete (params as any)[k]
  }
  if (scene.post) Object.assign(post, DEFAULT_POST, scene.post)
  if (scene.projection) projection.value = scene.projection
  if (scene.panX !== undefined) panX.value = scene.panX
  if (scene.panY !== undefined) panY.value = scene.panY
  if (scene.bgColor) bgColor.value = scene.bgColor
  if (scene.gradientStops) gradientStops.splice(0, gradientStops.length, ...scene.gradientStops.map(g => ({ ...g })))
  pullTextLines(); pullFills()
}

// Reset params to the current effect's defaults, carrying over the content keys
// (text/font). Shared by the effect-switch reset and the manual "Reset to defaults".
async function applyEffectDefaults() {
  const next = defaultsFromControls(effect.value.controls)
  for (const k of Object.keys(next)) if (CARRY_ON_SWITCH.has(k) && k in params) next[k] = (params as any)[k]
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, next)
  pullTextLines()
  pullFills()
  const sc = spaceDefaultFor(effect.value.id)
  if (sc) applyDefaultScene(sc)
  await ensureEffectFonts()
  rebuild()
}
watch(effectId, async () => {
  // Restoring a saved scene — keep the hydrated params instead of resetting to
  // this effect's defaults. Self-clears so the next real user switch resets.
  if (hydrating) { hydrating = false; return }
  engine?.setEffect(effect.value)
  await applyEffectDefaults()
})

const capturingThumb = ref(false)
async function captureThumbnail() {
  if (!engine) return
  capturingThumb.value = true
  stopPreview()
  try {
    const tw = 480
    const th = Math.max(1, Math.round(tw * H.value / W.value))
    engine.renderFrameAt(previewT01, params)   // capture the frame currently on screen
    const blob = await engine.frameToBlob(tw, th)
    const ok = await saveEffectThumbnail(effectId.value, blob)
    if (!ok) console.error('[space-type] failed to save thumbnail')
  } finally {
    capturingThumb.value = false
    startPreview()
  }
}

const savingDefault = ref(false)
async function makeAsDefault() {
  savingDefault.value = true
  try {
    const scene: Scene = {
      // Save the look AND the authored camera as-is — the framing you set becomes the effect's
      // new default (zeroing the camera made tilt-dependent effects render edge-on/black).
      params: { ...params },
      post: { ...post },
      projection: projection.value,
      panX: panX.value, panY: panY.value,
      bgColor: bgColor.value,
      gradientStops: gradientStops.map(g => ({ ...g })),
    }
    const ok = await saveSpaceDefault(effectId.value, scene)
    if (!ok) console.error('[space-type] failed to save default scene')
  } finally {
    savingDefault.value = false
  }
}
// Transparency + background apply live via render-time clear settings (no renderer rebuild).
watch([transparent, bgColor], () => engine?.setBackground(transparent.value, bgColor.value))
// Projection (perspective ↔ isometric) applies live; also re-render the held preview frame.
watch(projection, (p) => { engine?.setProjection(p); engine?.renderFrameAt(previewT01, params) })
// Pan re-frames live (no rebuild) — read by the engine per frame as a camera view-offset.
watch([panX, panY], () => { engine?.setPan(panX.value, panY.value); engine?.renderFrameAt(previewT01, params) })
// Post-processing applies live (composer uniforms; no scene rebuild). Re-render the held frame so a
// paused preview updates immediately too.
watch(post, () => { engine?.setPost({ ...post }); engine?.renderFrameAt(previewT01, params) }, { deep: true })
// Loop length affects the engine's frameCount used during bake.
watch(loopDuration, d => engine?.setLoopDuration(d))
// fps affects the engine's frameCount used during bake/preview.
watch(fps, f => engine?.setFps(f))
watch(dimsKey, (k) => {
  const d = DIMS[k]
  if (!d) return
  W.value = d[0]
  H.value = d[1]
  engine?.setSize(W.value, H.value)
})

// The String effect is flat + front-locked: force the orthographic (front-on) camera
// and zero pan so the drawn path maps 1:1 to what's rendered. The Projection/Pan UI is
// hidden for it. Immediate so the very first build (and reopened nodes) lock correctly.
const frontLocked = computed(() => effectId.value === 'string')
watch(frontLocked, (fl) => {
  if (fl) { projection.value = 'isometric'; panX.value = 0; panY.value = 0 }
}, { immediate: true })

// Streamer reads best in the orthographic (parallel) projection — like STG's ribbon. Default to
// it when the effect is selected/loaded, but leave the Projection control free (unlike String's
// lock). immediate so a freshly-opened Streamer comes up orthographic; a saved node's stored
// projection is applied afterward in the load path and still wins.
watch(effectId, (id) => { if (id === 'streamer') projection.value = 'isometric' }, { immediate: true })

const cfg = computed(() => ({
  effectId: effect.value.id, params: { ...params }, fps: fps.value, loopDuration: loopDuration.value,
  W: W.value, H: H.value, alpha: transparent.value, bgColor: bgColor.value, projection: projection.value,
  panX: panX.value, panY: panY.value,
}))

// Supersample factor for bakes/exports: render at N× the output size then downscale, so
// texture/text edges come out clean (MSAA only smooths polygon silhouettes). Offline only.
const BAKE_SS = 2

// Studio param-baker (Slice 2a Task 8c) — bakes ONE frame with a set of
// `params.*` overrides applied (a collection sweep/generate row), without
// disturbing the studio's live on-screen scene. Type Studio's controls are
// flat `params[key]` writes (like Texture Studio — no dotted-path proxy, no
// layer scoping), so overrides are snapshotted/written directly on `params`.
// UNLIKE Gradient/Shader/Texture's bake paths, Type Studio's renderer is
// STRUCTURAL: `engine.build(params, texOpts())` (via `rebuild()`) must run
// after writing the overrides — `engine.renderFrame`/`renderFrameAt` alone
// only re-poses the already-built scene graph, so a param that changes
// geometry/text/material (most of them) would be invisible without a
// rebuild first. `ensureEffectFonts()` is awaited first too, mirroring
// `generateImage`'s own sequence, in case an override touches `font`.
// Everything here (`build`/`renderFrame`) is still synchronous — only
// `frameToBlob`'s `canvas.toBlob` wrapper is awaited — so no extra
// `nextTick`/rAF wait is needed beyond the existing async font load.
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  if (!engine) return null
  const keys = Object.keys(overrides)
  const snapshot = new Map<string, unknown>()
  for (const key of keys) snapshot.set(key, (params as Record<string, unknown>)[key])
  // Claim ownership of rebuilds for the duration of the bake: writing overrides onto
  // `params` below also trips the structuralSignature watch, which would otherwise
  // queue its own uncoordinated rebuild via rAF that could land mid-bake (reading a
  // half-restored `params`) or race the restore in the `finally` below. Cancel any
  // rebuild already in flight from a pre-bake edit — the explicit rebuild() calls in
  // this function supersede it.
  bakingOverrides = true
  if (rebuildRaf) { cancelAnimationFrame(rebuildRaf); rebuildRaf = 0 }
  let userEditedDuringBake = false
  let unwatchGuard: () => void = () => {}
  try {
    for (const key of keys) (params as Record<string, unknown>)[key] = overrides[key]!
    const baselineSig = structuralSignature()
    unwatchGuard = watch(structuralSignature, (newSig) => {
      if (newSig !== baselineSig) userEditedDuringBake = true
    }) as unknown as () => void
    await ensureEffectFonts()
    engine.setSize(W.value * BAKE_SS, H.value * BAKE_SS)
    rebuild()
    engine.renderFrame(0, params)
    const blob = await engine.frameToBlob(W.value, H.value)
    engine.setSize(W.value, H.value)
    return blob
  } catch (e) {
    console.error('[space-type] param-baker render failed', e)
    return null
  } finally {
    unwatchGuard()
    for (const key of keys) {
      if (snapshot.has(key)) (params as Record<string, unknown>)[key] = snapshot.get(key)
    }
    await ensureEffectFonts()
    rebuild()
    bakingOverrides = false
    // If a user edit landed mid-bake (its own scheduleRebuild() was suppressed above),
    // the rebuild() just above only reflects the restored pre-bake params, not that
    // edit — schedule one trailing rebuild now that the flag is clear so the edit
    // isn't silently dropped.
    if (userEditedDuringBake) scheduleRebuild()
  }
}

async function generateImage() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    await ensureEffectFonts()
    engine.setSize(W.value * BAKE_SS, H.value * BAKE_SS)
    rebuild()
    engine.renderFrame(0, params)
    const blob = await engine.frameToBlob(W.value, H.value)
    engine.setSize(W.value, H.value)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'spacetype_img')
    if (filename) {
      // Stash a thumbnail on the node so its card shows a preview.
      const n = currentNode()
      if (n) {
        if (!n.data) n.data = {}
        if (!n.data.properties) n.data.properties = {}
        const prev = n.data.properties.comfynext_spaceType || {}
        n.data.properties.comfynext_spaceType = { ...prev, thumb: `/view?filename=${filename}&type=input` }
      }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:spaceTypeOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } finally {
    baking.value = false
    startPreview()
  }
}

async function generateVideo() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    await ensureEffectFonts()
    engine.setSize(W.value * BAKE_SS, H.value * BAKE_SS)
    engine.setFps(fps.value)
    engine.setLoopDuration(loopDuration.value)
    rebuild()
    const rates = seamlessLoop.value ? (effect.value.loopRates?.(params) ?? []) : []
    const k = loopMultiplier(rates)
    const origFrames = Math.max(1, Math.round(fps.value * loopDuration.value))
    const loopCfg = k > 1 ? { ...cfg.value, loopDuration: loopDuration.value * k } : cfg.value
    const bake = await ensureSpaceTypeBake(loopCfg, undefined, {
      // Unwrapped t01 = i / origFrames runs 0..k so motions keep their per-loop rate across k loops
      // and land on whole cycles → seamless. k=1 is identical to the previous behavior.
      renderFrame: async (i) => { engine!.renderFrameAt(i / origFrames, params); return engine!.frameToBlob(W.value, H.value) },
    })
    engine.setSize(W.value, H.value)
    const res = await fetch('/comfynext/spacetype_encode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: bake.frames, fps: fps.value, width: W.value, height: H.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('comfynext:spaceTypeOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } },
      }))
      closeEditor()
    } else {
      console.error('[spacetype] video encode failed', data)
      alert('Video encode failed — make sure ComfyUI was restarted to load the encoder. See console.')
    }
  } finally {
    baking.value = false
    startPreview()
  }
}
</script>

<template>
  <StudioModalShell title="Type studio" :breadcrumb="effect.label" @close="closeEditor">
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg" style="background:#0e0e10" />
        <div v-if="renderError"
             class="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-amber-400/30 bg-black/70 px-3 py-2 text-[11px] text-amber-200/90">
          Effect failed to render — adjust a parameter to recover.
        </div>
        <div v-if="!webglOk" class="absolute inset-0 flex items-center justify-center text-xs text-white/50">
          3D preview unavailable on this device.
        </div>
        <StringPathEditor
          v-if="frontLocked"
          :model-value="String(params.path ?? '')"
          :canvas="canvas"
          @update:model-value="(v: string) => (params.path = v)"
        />
      </div>
    </template>
    <template #actions>
      <StudioButton variant="primary" :disabled="baking" @click="generateImage">
        {{ baking ? 'Generating…' : 'Generate as image' }}
      </StudioButton>
      <StudioButton variant="secondary" :disabled="baking" @click="generateVideo">
        {{ baking ? 'Generating…' : 'Generate as video' }}
      </StudioButton>
    </template>
    <template #controls>
      <VibeControlBar
        :busy="vibeBusy"
        :proposal="vibeProposal"
        @submit="onVibe"
        @keep="onVibeKeep"
        @revert="onVibeRevert"
        @focus-control="onVibeFocus"
      />
      <div class="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
          <label class="mb-1 block text-[11px] text-white/50">Effect</label>
          <button type="button" @click="showEffectGallery = true"
                  class="flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 hover:border-white/25">
            <span class="truncate">{{ effect.label }}</span>
            <span class="ml-2 shrink-0 text-white/40">▾</span>
          </button>
          <div class="mt-2 flex items-center justify-between">
            <button type="button" @click="applyEffectDefaults"
                    class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25">
              Reset to defaults
            </button>
            <button type="button" @click="makeAsDefault" :disabled="savingDefault"
                    class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25 disabled:opacity-40">
              {{ savingDefault ? 'Saving…' : 'Make as default' }}
            </button>
          </div>
          <div v-if="SHOW_THUMB_CAPTURE" class="mt-2 flex justify-end">
            <button v-if="SHOW_THUMB_CAPTURE" type="button" @click="captureThumbnail" :disabled="capturingThumb"
                    class="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:border-white/25 disabled:opacity-40">
              {{ capturingThumb ? 'Capturing…' : 'Capture thumbnail' }}
            </button>
          </div>
          <template v-if="!frontLocked">
            <label class="mb-1 mt-2.5 block text-[11px] text-white/50">Projection</label>
            <select v-model="projection" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85">
              <option value="perspective" class="bg-neutral-900">Perspective</option>
              <option value="isometric" class="bg-neutral-900">Isometric</option>
            </select>
            <label class="mb-1.5 mt-2.5 flex justify-between text-[11px] text-white/50">
              <span>Pan X</span><span class="font-mono text-white/80">{{ panX.toFixed(2) }}</span>
            </label>
            <input v-model.number="panX" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
            <label class="mb-1.5 mt-2.5 flex justify-between text-[11px] text-white/50">
              <span>Pan Y</span><span class="font-mono text-white/80">{{ panY.toFixed(2) }}</span>
            </label>
            <input v-model.number="panY" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
          </template>
        </div>
        <StudioSection
          v-for="section in sections" :key="section.name"
          v-show="section.controls.length || section.name === 'Color' || section.name === 'Output'"
          :title="section.name"
          :open="openSections[section.name]"
        >
          <div class="space-y-3">
            <div
              v-for="c in section.controls" :key="c.key"
              v-show="!(c.key === 'typeWeight' && !fontIsVariable) && controlIsVisible(c)"
              :data-control-key="c.key"
              :class="{ 'rounded-md ring-1 ring-amber-400/30 px-1 -mx-1': vibeMoved.has(c.key) }"
              data-control class="text-xs"
              @contextmenu.prevent="openVarMenu($event, c)">
              <label v-if="c.kind !== 'slider'" class="mb-1 flex items-center gap-1.5 text-white/60">
                <span>{{ c.label }}</span>
                <BindableControlChip :column-key="boundColumnFor(c.key)" @menu="openVarMenu($event, c)" />
              </label>
              <div v-else class="mb-1.5 flex items-center gap-1.5">
                <BindableControlChip :column-key="boundColumnFor(c.key)" @menu="openVarMenu($event, c)" />
              </div>
              <span v-if="vibeMoved.has(c.key) && vibeSnapshot && c.kind !== 'slider'" class="ml-1 text-[10px] text-amber-400/80">was {{ fmt(vibeSnapshot[c.key]) }}</span>
              <StudioSlider v-if="c.kind === 'slider'" :label="c.label"
                            :min="Number(c.min ?? 0)" :max="Number(c.max ?? 1)" :step="Number(c.step ?? 1)"
                            :default="Number(c.default ?? 0)"
                            :model-value="Number(params[c.key])"
                            @update:model-value="(v: number) => { params[c.key] = v; onEdit(c.key, v) }" />
              <input v-else-if="c.kind === 'text'" type="text" v-model="params[c.key]"
                     class="w-full rounded bg-white/10 px-2 py-1" @input="rebuild" @change="onEdit(c.key, String(params[c.key]))" />
              <template v-else-if="c.kind === 'textList'">
                <div v-for="(_, i) in textLines" :key="i" data-row
                     class="mb-1 flex items-center gap-1 rounded transition-shadow"
                     :class="drag.kind === 'text' && drag.over === i && drag.from !== i ? 'ring-1 ring-white/40' : ''"
                     @dragover="dragOver('text', i, $event)" @drop="dropRow('text', i)">
                  <span draggable="true" @dragstart="dragStart('text', i, $event)" @dragend="dragEnd"
                        class="shrink-0 cursor-grab px-0.5 text-white/25 hover:text-white/60 active:cursor-grabbing" title="Drag to reorder" aria-label="Drag to reorder">
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="4" r="1" /><circle cx="7.5" cy="4" r="1" /><circle cx="2.5" cy="8" r="1" /><circle cx="7.5" cy="8" r="1" /><circle cx="2.5" cy="12" r="1" /><circle cx="7.5" cy="12" r="1" /></svg>
                  </span>
                  <input type="text" v-model="textLines[i]" class="w-full rounded bg-white/10 px-2 py-1" />
                  <button v-if="textLines.length > 1" type="button" @click="removeTextRow(i)"
                          class="shrink-0 rounded px-2 py-1 text-white/40 hover:bg-white/10 hover:text-white">−</button>
                </div>
                <button type="button" @click="addTextRow"
                        class="mt-0.5 rounded bg-white/10 px-2 py-1 text-white/60 hover:text-white">+ Add text</button>
                <p class="mt-1 text-[10px] text-white/40">Multiple texts alternate per repeat.</p>
              </template>
              <template v-else-if="c.kind === 'fillList'">
                <div class="space-y-2">
                  <div v-for="(f, i) in fills" :key="i" data-row
                       class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 transition-shadow"
                       :class="drag.kind === 'fill' && drag.over === i && drag.from !== i ? 'ring-1 ring-white/40' : ''"
                       @dragover="dragOver('fill', i, $event)" @drop="dropRow('fill', i)">
                    <!-- grip + type + remove -->
                    <div class="flex items-center gap-1.5">
                      <span draggable="true" @dragstart="dragStart('fill', i, $event)" @dragend="dragEnd"
                            class="shrink-0 cursor-grab text-white/25 hover:text-white/60 active:cursor-grabbing" title="Drag to reorder" aria-label="Drag to reorder">
                        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="4" r="1" /><circle cx="7.5" cy="4" r="1" /><circle cx="2.5" cy="8" r="1" /><circle cx="7.5" cy="8" r="1" /><circle cx="2.5" cy="12" r="1" /><circle cx="7.5" cy="12" r="1" /></svg>
                      </span>
                      <span class="w-3 shrink-0 text-center text-[10px] tabular-nums text-white/30">{{ i + 1 }}</span>
                      <StudioSelect class="flex-1" :options="FILL_TYPES" :model-value="f.type"
                                    @update:model-value="(v: string) => f.type = v as FillType" />
                      <button v-if="fills.length > 1" type="button" @click="removeFill(i)" aria-label="Remove fill"
                              class="shrink-0 rounded-md p-1 text-white/30 hover:bg-white/10 hover:text-rose-300">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                      </button>
                    </div>
                    <!-- colours: fill pair grouped left, text colour pushed right -->
                    <div class="mt-2.5 flex items-end gap-2.5 pl-6">
                      <div class="flex flex-col items-center gap-1">
                        <span class="text-[9px] uppercase tracking-wide text-white/35">{{ fillNeedsB(f) ? 'Color 1' : 'Fill' }}</span>
                        <StudioColor v-model="f.a" />
                      </div>
                      <div v-if="fillNeedsB(f)" class="flex flex-col items-center gap-1">
                        <span class="text-[9px] uppercase tracking-wide text-white/35">Color 2</span>
                        <StudioColor v-model="f.b" />
                      </div>
                      <div class="flex-1"></div>
                      <div class="flex flex-col items-center gap-1">
                        <span class="text-[9px] uppercase tracking-wide text-white/35">Text</span>
                        <StudioColor v-model="f.textColor" />
                      </div>
                    </div>
                    <!-- pattern controls (only the ones this type uses) -->
                    <div v-if="fillHasAngle(f) || fillHasDensity(f)" class="mt-2.5 space-y-1.5 pl-6">
                      <StudioSlider v-if="fillHasAngle(f)" v-model="f.angle" :label="f.type === 'stripes' ? 'Angle' : 'Fade angle'" :min="0" :max="180" :step="5" />
                      <StudioSlider v-if="fillHasDensity(f)" v-model="f.density" label="Density" :min="1" :max="32" :step="1" />
                    </div>
                  </div>
                  <button type="button" @click="addFill"
                          class="w-full rounded-lg border border-dashed border-white/15 py-1.5 text-[11px] text-white/50 hover:border-white/30 hover:text-white/80">+ Add fill</button>
                  <p class="text-[10px] leading-relaxed text-white/35">Fills apply top-to-bottom and repeat if there are more slots than fills. <span class="text-white/50">Text</span> is the type colour for that fill.</p>
                </div>
              </template>
              <p v-else-if="c.kind === 'path'" class="text-[10px] leading-relaxed text-white/40">
                Draw on the preview: click-drag to add a point (drag sets its curve handle),
                drag points/handles to adjust. <b>Enter</b> = new string, <b>Del</b> = remove,
                <b>Reset</b> clears.
              </p>
              <CurveEditor v-else-if="c.kind === 'curve'" :model-value="String(params[c.key])"
                           @update:model-value="(val: string) => { params[c.key] = val }" />
              <StudioColor v-else-if="c.kind === 'color'" :model-value="String(params[c.key])"
                           @update:model-value="(val: string) => { params[c.key] = val; rebuild(); onEdit(c.key, val) }" />
              <StudioSegmented v-else-if="c.kind === 'select' && (c.options?.length ?? 0) <= 3"
                               :options="c.options ?? []" :model-value="String(params[c.key])"
                               @update:model-value="(v: string) => { params[c.key] = v; rebuild(); onEdit(c.key, v) }" />
              <StudioSelect v-else-if="c.kind === 'select'"
                            :options="c.options ?? []" :model-value="String(params[c.key])"
                            @update:model-value="(v: string) => { params[c.key] = v; rebuild(); onEdit(c.key, v) }" />
              <template v-else-if="c.kind === 'font'">
                <button type="button" @click="fontPickerOpen = !fontPickerOpen"
                        class="flex w-full items-center justify-between rounded bg-white/10 px-2 py-1 text-left">
                  <span class="truncate">{{ params[c.key] || 'Select font…' }}</span>
                  <span class="ml-2 shrink-0 text-white/40">{{ fontPickerOpen ? '▴' : '▾' }}</span>
                </button>
                <div v-if="fontPickerOpen" class="mt-1 rounded bg-black/40 p-1">
                  <div class="mb-1 flex items-center gap-1">
                    <input v-model="fontSearch" placeholder="Search or describe fonts…" autofocus
                           @keydown.enter.prevent="runFontSuggest"
                           class="w-full flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1" />
                    <button type="button" title="Suggest fonts from a description"
                            :disabled="fontSuggestLoading" @click="runFontSuggest"
                            class="shrink-0 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 hover:border-white/25 disabled:opacity-40">✨ Ask AI</button>
                  </div>
                  <label class="mb-1 flex items-center justify-between px-1 py-0.5 text-[11px] text-white/55">
                    <span>Variable fonts only</span>
                    <StudioSwitch v-model="variableOnly" />
                  </label>
                  <!-- ✨ Suggested (from a description) -->
                  <div v-if="fontSuggestLoading || fontSuggestError || fontSuggestions.length || fontSuggestRan" class="mb-1">
                    <p class="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">✨ Suggested</p>
                    <p v-if="fontSuggestLoading" class="px-2 py-1 text-white/40">Finding fonts…</p>
                    <p v-else-if="fontSuggestError" class="px-2 py-1 text-white/40">{{ fontSuggestError }}</p>
                    <p v-else-if="!fontSuggestions.length" class="px-2 py-1 text-white/40">No matches — try describing the style differently.</p>
                    <button v-for="s in fontSuggestions" :key="'s' + s.family" type="button"
                            @click="selectFont(c.key, s.family)"
                            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
                            :class="{ 'bg-white/15': params[c.key] === s.family }">
                      <span class="min-w-0 flex-1">
                        <span class="block truncate" :style="{ fontFamily: s.family }">{{ s.family }}</span>
                        <span class="block truncate text-[10px] text-white/40">{{ s.reason }}</span>
                      </span>
                      <span class="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-white/40">{{ s.category }}</span>
                    </button>
                    <div class="mx-2 my-1 border-t border-white/10" />
                  </div>
                  <div class="max-h-48 overflow-y-auto">
                    <button v-for="f in filteredFonts" :key="f.family" type="button"
                            @click="selectFont(c.key, f.family)"
                            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
                            :class="{ 'bg-white/15': params[c.key] === f.family }">
                      <span class="truncate">{{ f.family }}</span>
                      <span v-if="isVar(f)" :title="`Variable axes: ${varAxes(f)}`"
                            class="ml-auto shrink-0 rounded bg-white/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-white/70">var</span>
                    </button>
                    <p v-if="!fontCatalog.length" class="px-2 py-1 text-white/40">Loading fonts…</p>
                    <p v-else-if="!filteredFonts.length" class="px-2 py-1 text-white/40">No matches</p>
                  </div>
                </div>
                <div v-if="varAxisList.length" class="mt-2 space-y-2.5">
                  <StudioSlider v-for="a in varAxisList" :key="a.tag"
                                :model-value="fontAxes[a.tag] ?? a.default" @update:model-value="(v: number) => { fontAxes[a.tag] = v }"
                                :label="a.label" :min="a.min" :max="a.max" :step="a.step" :default="a.default" />
                </div>
                <p v-if="!fontIsVariable" class="mt-1 text-[10px] text-white/40">Static font — weight axis unavailable.</p>
              </template>
            </div>

            <template v-if="section.name === 'Output'">
              <div data-control class="text-xs">
                <label class="mb-1 block text-white/60">Dimensions</label>
                <select v-model="dimsKey" class="w-full rounded bg-white/10 px-2 py-1">
                  <option v-for="k in Object.keys(DIMS)" :key="k" :value="k">{{ k }}</option>
                  <option :value="CUSTOM">Custom…</option>
                </select>
                <div class="mt-1 flex items-center gap-1">
                  <input type="number" min="16" max="4096" step="2" v-model.number="W" @change="onCustomDims"
                         class="w-full rounded bg-white/10 px-2 py-1" aria-label="Width" />
                  <span class="text-white/40">×</span>
                  <input type="number" min="16" max="4096" step="2" v-model.number="H" @change="onCustomDims"
                         class="w-full rounded bg-white/10 px-2 py-1" aria-label="Height" />
                </div>
              </div>
              <div data-control class="text-xs">
                <label class="mb-1 block text-white/60">FPS</label>
                <select v-model.number="fps" class="w-full rounded bg-white/10 px-2 py-1">
                  <option v-for="f in FPS_OPTIONS" :key="f" :value="Number(f)">{{ f }}</option>
                </select>
              </div>
              <div data-control class="text-xs">
                <label class="mb-1 flex justify-between text-white/60">
                  <span>Duration</span>
                  <span class="text-white/80">{{ loopDuration }}s · {{ Math.round(fps * loopDuration) }} frames</span>
                </label>
                <input type="range" min="1" max="15" step="0.5" v-studio-reset v-model.number="loopDuration" class="studio-range w-full" />
              </div>
              <label data-control class="flex items-center justify-between text-xs text-white/60">
                <span>Seamless loop</span><StudioSwitch v-model="seamlessLoop" />
              </label>
              <label data-control class="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" v-model="transparent" /> Transparent background
              </label>
              <div v-if="!transparent" data-control class="text-xs">
                <label class="mb-1 block text-white/60">Background color</label>
                <StudioColor v-model="bgColor" />
              </div>
            </template>
          </div>
        </StudioSection>

        <!-- Shared post-processing — applies to every effect, live + in exports. -->
        <StudioSection title="Post" :open="openSections.Post">
          <div class="space-y-3">
            <label data-control class="flex items-center justify-between text-xs text-white/70">
              <span>Bloom</span><StudioSwitch v-model="post.bloom" />
            </label>
            <template v-if="post.bloom">
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Strength</span><span class="text-white/80">{{ post.bloomStrength.toFixed(2) }}</span></label>
                <input type="range" min="0" max="3" step="0.05" v-studio-reset v-model.number="post.bloomStrength" class="studio-range w-full" /></div>
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Radius</span><span class="text-white/80">{{ post.bloomRadius.toFixed(2) }}</span></label>
                <input type="range" min="0" max="1" step="0.05" v-studio-reset v-model.number="post.bloomRadius" class="studio-range w-full" /></div>
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Threshold</span><span class="text-white/80">{{ post.bloomThreshold.toFixed(2) }}</span></label>
                <input type="range" min="0" max="1" step="0.05" v-studio-reset v-model.number="post.bloomThreshold" class="studio-range w-full" /></div>
            </template>

            <label data-control class="flex items-center justify-between text-xs text-white/70">
              <span>Color</span><StudioSwitch v-model="post.color" />
            </label>
            <template v-if="post.color">
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Exposure</span><span class="text-white/80">{{ post.exposure.toFixed(2) }}</span></label>
                <input type="range" min="0.2" max="2" step="0.05" v-studio-reset v-model.number="post.exposure" class="studio-range w-full" /></div>
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Contrast</span><span class="text-white/80">{{ post.contrast.toFixed(2) }}</span></label>
                <input type="range" min="0" max="2" step="0.05" v-studio-reset v-model.number="post.contrast" class="studio-range w-full" /></div>
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Saturation</span><span class="text-white/80">{{ post.saturation.toFixed(2) }}</span></label>
                <input type="range" min="0" max="2" step="0.05" v-studio-reset v-model.number="post.saturation" class="studio-range w-full" /></div>
              <div data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Hue</span><span class="text-white/80">{{ post.hue.toFixed(2) }}</span></label>
                <input type="range" min="-3.14" max="3.14" step="0.05" v-studio-reset v-model.number="post.hue" class="studio-range w-full" /></div>
            </template>

            <label data-control class="flex items-center justify-between text-xs text-white/70">
              <span>Chroma</span><StudioSwitch v-model="post.chroma" />
            </label>
            <div v-if="post.chroma" data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Amount</span><span class="text-white/80">{{ post.chromaAmount.toFixed(2) }}</span></label>
              <input type="range" min="0" max="1.5" step="0.02" v-studio-reset v-model.number="post.chromaAmount" class="studio-range w-full" /></div>

            <label data-control class="flex items-center justify-between text-xs text-white/70">
              <span>Lens blur</span><StudioSwitch v-model="post.blur" />
            </label>
            <div v-if="post.blur" data-control class="text-xs"><label class="mb-1 flex justify-between text-white/50"><span>Amount</span><span class="text-white/80">{{ post.blurAmount.toFixed(3) }}</span></label>
              <input type="range" min="0" max="0.04" step="0.002" v-studio-reset v-model.number="post.blurAmount" class="studio-range w-full" /></div>
          </div>
        </StudioSection>
    </template>
  </StudioModalShell>
  <SpaceTypeEffectGalleryModal
    v-if="showEffectGallery"
    :selected-id="effectId"
    @select="onPickEffect"
    @close="showEffectGallery = false"
  />
  <CanvasContextMenu
    v-if="varMenu"
    :x="varMenu.x"
    :y="varMenu.y"
    :items="varMenu.items"
    @close="varMenu = null"
  />
  <SweepPopover
    v-if="sweepPopover"
    :control="sweepPopover.control"
    :anchor="sweepPopover.anchor"
    @apply="applySweep"
    @close="sweepPopover = null"
  />
</template>
