<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'
import { buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { getEffect } from '~/lib/spacetype/effects'
import { ensureBoostFont } from '~/lib/spacetype/effects/boost'
import { defaultsFromControls, type Params, type ControlSpec } from '~/lib/spacetype/effect'
import { SPACE_TYPE_SECTIONS } from '~/lib/spacetype/sections'
import { parseFills, serializeFills, FILL_TYPES, type Fill, type FillType } from '~/lib/spacetype/fills'
import { DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import ShaderFillEditor from '~/components/vue-canvas/widgets/ShaderFillEditor.vue'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { DEFAULT_POST, type PostSettings } from '~/lib/spacetype/post'
import type { SpaceTypeState } from '~/lib/spacetype/state'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { encodeFrames, type EncodeFramesResult } from '~/lib/engine/encodeVideo'
import { canvasHasAlpha } from '~/lib/engine/hasAlpha'
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'
import { useStudioAutosave } from '~/lib/studio/autosave'
import { loopMultiplier } from '~/lib/spacetype/loop'
import { loadGoogleCatalog, googleFontCssUrl, googleAxisList, resolveFontFamily, fontHasWeightAxis, type GoogleFont } from '~/data/google-fonts'
import type { GradientStop } from '~/lib/spacetype/gradient'
import FontPicker from '~/components/vue-canvas/FontPicker.vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioActionsFooter from '~/components/vue-canvas/studio/StudioActionsFooter.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import CurveEditor from '~/components/vue-canvas/CurveEditor.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioColorField from '~/components/vue-canvas/studio/StudioColorField.vue'
import StudioRow from '~/components/vue-canvas/studio/StudioRow.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StringPathEditor from '~/components/vue-canvas/StringPathEditor.vue'
import VibeControlBar from '~/components/vue-canvas/VibeControlBar.vue'
import SpaceTypeEffectGalleryModal from '~/components/vue-canvas/SpaceTypeEffectGalleryModal.vue'
import { useVibeControl } from '~/composables/useVibeControl'
import { loadSpaceDefaults, spaceDefaultFor, saveSpaceDefault } from '~/composables/useSpaceDefaults'
import { saveEffectThumbnail } from '~/composables/useEffectThumbnails'
import { SCENE_CONTENT_KEYS, type Scene } from '~/lib/spacetype/scene'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
import { fillSwatchKey, parseFillSwatchKey, writeFillSwatch, type FillSwatchField } from '~/lib/spacetype/fillSwatchPath'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { controlKindToVariableType, type StudioControlDesc } from '~/lib/collection/studioBindables'
import { typeCompatible } from '~/lib/collection/bindables'
import { addSweepRows } from '~/lib/collection/model'
import { COLLECTION_PROP, VARS_TYPE, type CollectionColumn, type CollectionData } from '~/lib/collection/types'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { showIfVisible } from '~/lib/studio/sections'
import { effectiveColumns, makeLookupResolver } from '~/lib/collection/lookup'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import { exportEmbedHtml, downloadEmbed } from '~/lib/embed/export'
import type { SpaceTypeEmbedConfig } from '~/lib/embed/surfaces/spacetype'
// fontSourceUrl already resolves a `google:Family@weight` token to the
// `/api/scene3d/google-font-file` proxy URL for the 3D Studio's text-extrude
// path (see outlines.ts's own doc) — reused here rather than inventing a
// second font-fetch path for the embed export.
import { fontSourceUrl } from '~/lib/scene3d/outlines'

const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills/videos as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

// Locate this node + its saved config blob on the canvas. The config lives at
// node.data.properties.sailor_spaceType so it survives serialization
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
  // Motion controls live on the Motion inspector tab (v-show'd away on Design) — flip
  // to the right tab first or the scroll silently no-ops on a hidden section.
  const group = effect.value.controls.find(c => c.key === path)?.group
  inspectorTab.value = group === 'Motion' ? 'motion' : 'design'
  nextTick(() => {
    const el = document.querySelector(`[data-control-key="${path}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
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
// Switching a fill INTO 'shader' seeds a fresh spec (cloned — DEFAULT_SHADER_SPEC is a
// shared module constant, never mutated in place) so ShaderFillEditor has something real
// to bind to immediately, rather than relying on its `?? DEFAULT_SHADER_SPEC` fallback.
function setFillType(f: Fill, t: FillType) {
  if (t === 'shader' && !f.shader) f.shader = structuredClone(DEFAULT_SHADER_SPEC)
  f.type = t
}
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
// ── web embed export ────────────────────────────────────────────────────────
const embedding = ref(false)
const embedMsg = ref('')
const embedErr = ref(false)
// Non-zero when the engine capped one or more shader fills at a frozen (t=0) snapshot
// this frame because too many live fields were requested at once (LIVE_FIELD_CEILING,
// see ~/lib/shaderfill/field.ts). The design forbids silently truncating — the user
// must see why a shader fill stopped animating rather than assume it's broken.
const frozenFieldCount = ref(0)

// Collapsible control sections. Effect controls declare their `group`; surface-only
// controls (gradient stops, loop, dimensions, transparent) are injected per section.
const SECTION_ORDER = SPACE_TYPE_SECTIONS
// Sections that should start collapsed; everything else starts open. 'Post' is a
// surface-injected section (not in SPACE_TYPE_SECTIONS) rendered as a standalone card.
const DEFAULT_COLLAPSED = new Set([
  'Layout', 'Skew', 'Warp', 'Stroke', 'Doodles', 'Shadow', 'Wave', 'Motion', 'Transform', 'Post', 'Output', 'Camera',
])
const openSections = reactive<Record<string, boolean>>(
  Object.fromEntries([...SPACE_TYPE_SECTIONS, 'Post'].map(name => [name, !DEFAULT_COLLAPSED.has(name)])),
)
const sections = computed(() =>
  SECTION_ORDER.map(name => ({ name, controls: effect.value.controls.filter(c => c.group === name) })),
)

// Inspector tabs — Design (everything) vs Motion (the effect's Motion-group controls),
// matching 3D Studio's Build|Motion split. Motion sections render open, not collapsible.
const inspectorTab = ref<'design' | 'motion'>('design')
const motionControlCount = computed(() => effect.value.controls.filter(c => c.group === 'Motion').length)
function sectionVisible(section: { name: string; controls: ControlSpec[] }): boolean {
  if (inspectorTab.value === 'motion') return section.name === 'Motion' && section.controls.length > 0
  if (section.name === 'Motion') return false
  if (section.name === 'Camera') return !frontLocked.value
  return section.controls.length > 0 || section.name === 'Color' || section.name === 'Output'
}

/** A control may declare `showIf` to appear only when another param matches (e.g. a second axis's
 *  controls that only apply in a 'crosshatch' mode). Reactive via `params`. */
function controlIsVisible(c: ControlSpec): boolean {
  return showIfVisible(c, k => params[k])
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
function swatchKey(i: number, field: FillSwatchField): string {
  const k = fillKey(); return k ? fillSwatchKey(k, i, field) : `fills.${i}.${field}`
}
function swatchDesc(i: number, field: FillSwatchField, label: string): StudioControlDesc {
  return { key: swatchKey(i, field), label: `Fill ${i + 1} · ${label}`, kind: 'color' }
}
// Each fill's colour swatch(es) become synthetic `color` controls so the binding
// machinery (promote / applyParamsPreview / run baker) can address one swatch inside
// the packed fills value. Regenerated from the live `fills` array each call.
function fillSwatchControls(): StudioControlDesc[] {
  const out: StudioControlDesc[] = []
  fills.forEach((f, i) => {
    out.push(swatchDesc(i, 'a', fillNeedsB(f) ? 'Color 1' : 'Fill'))
    if (fillNeedsB(f)) out.push(swatchDesc(i, 'b', 'Color 2'))
    out.push(swatchDesc(i, 'textColor', 'Text'))
  })
  return out
}
function activeControls(): StudioControlDesc[] {
  return [...effect.value.controls.map(controlDesc), ...fillSwatchControls()]
}
const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  activeControls,
  (key, value) => {
    const k = fillKey()
    const swatch = k ? parseFillSwatchKey(k, key) : null
    if (swatch && fills[swatch.index]) {
      // Writing the reactive `fills` array trips watch(fills) -> serializeFills ->
      // params.fills -> structuralSignature -> scheduleRebuild, so no explicit rebuild.
      ;(fills[swatch.index] as Record<string, unknown>)[swatch.field] = value
    } else {
      ;(params as Record<string, unknown>)[key] = value
      rebuild()
    }
  },
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
  if (!c) return []
  return effectiveColumns(c, makeLookupResolver(props.nodes))
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
  const columnKey = boundColumnKeyFor(control.key)
  if (!columnKey) return

  const added = addSweepRows(collection, columnKey, values)
  window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: String(colNode.id) } }))
  window.dispatchEvent(new CustomEvent('sailor:runSweepRows', {
    detail: { collectionNodeId: String(colNode.id), rowIds: added.map(r => r.id), targetNodeId: props.nodeId },
  }))
}

// Wired collection node id feeding this studio's `vars` input — shared by the
// "Go to collection" var-menu item and the bound-row "Edit in table" button.
function wiredCollectionNodeId(): string | null {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((ed: any) => String(ed.target) === String(props.nodeId) && ed?.data?.dataType === VARS_TYPE)
  return edge ? String(edge.source) : null
}
function goToCollection() {
  const nodeId = wiredCollectionNodeId()
  if (nodeId) window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId } }))
}

const varMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
function openVarMenu(e: MouseEvent, c: ControlSpec) {
  openVarMenuDesc(e, controlDesc(c), params[c.key] as string | number)
}
function openVarMenuDesc(e: MouseEvent, desc: StudioControlDesc, liveValue: string | number) {
  const type = controlKindToVariableType(desc.kind)
  if (type === null) return
  const bound = boundColumnFor(desc.key)
  const items: MenuItem[] = []
  if (!bound) {
    items.push({ label: 'Turn into variable', action: () => promote(desc, liveValue) })
    const compatCols = wiredColumns.value.filter(col => typeCompatible(type, col.type))
    if (compatCols.length) {
      items.push({
        label: 'Bind to',
        children: compatCols.map(col => ({
          label: col.label,
          action: () => window.dispatchEvent(new CustomEvent('sailor:bindControl', {
            detail: { nodeId: props.nodeId, path: `params.${desc.key}`, columnKey: col.key },
          })),
        })),
      })
    }
  }
  else {
    items.push({ label: 'Go to collection', action: goToCollection })
    items.push({ label: 'Sweep…', action: () => { sweepPopover.value = { control: desc, anchor: { x: e.clientX, y: e.clientY } } } })
    items.push({ divider: true })
    items.push({
      label: 'Unbind',
      action: () => {
        unbind(desc.key, liveValue)
        if (desc.kind === 'text' || desc.kind === 'textList') pullTextLines()
      },
    })
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
// used to decide weight-axis availability (FontPicker owns its own copy for the
// searchable dropdown; loadGoogleCatalog is module-cached so this is a no-op refetch).
const fontCatalog = ref<GoogleFont[]>([])
loadGoogleCatalog().then((c) => { fontCatalog.value = c })

function selectFont(key: string, family: string) {
  ;(params as Record<string, unknown>)[key] = family
  onEdit(key, family)
}
// FontPicker emits a discriminated payload; Type Studio only ever passes Google
// families through (no `pinned` prop), so the pinned branch never fires here.
function onFontSelect(key: string, payload: { kind: 'google'; family: string } | { kind: 'pinned'; value: string }) {
  if (payload.kind === 'google') selectFont(key, payload.family)
}
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
  // Skip while baking (generateImage/generateVideo/downloadVideoFile all call
  // rebuild() at supersampled bake resolution): this refresh reads back the
  // rendered canvas, and the bake path doesn't need it re-checked mid-bake —
  // see refreshExportAlpha's doc.
  if (!baking.value) refreshExportAlpha()
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
    frozenFieldCount.value = engine?.frozenFieldCount ?? 0
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
  const c = n?.data?.properties?.sailor_spaceType
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
  const prev = n.data.properties.sailor_spaceType || {}
  n.data.properties.sailor_spaceType = {
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

// Sticky footer status (StudioActionsFooter): real Saving…/Saved ✓ driven by
// useStudioAutosave (Task AF-3b), debounced off the same fields saveConfig()
// serializes onto the node. gradientStops/post are reactive objects — spreading
// them into the signature (rather than passing the live refs) makes the watched
// getter a plain JSON string, so `deep: true` inside the composable is inert but
// harmless. Closing the studio still calls saveConfig() directly (closeEditor /
// onBeforeUnmount below) so the FINAL edit is never left stranded in the debounce.
function autosaveSignature() {
  return JSON.stringify({
    effectId: effectId.value,
    params,
    gradientStops,
    post,
    fps: fps.value, loopDuration: loopDuration.value,
    dimsKey: dimsKey.value, W: W.value, H: H.value, transparent: transparent.value, bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value, panY: panY.value,
  })
}
const { saving: autoSaving, saved: autoSaved } = useStudioAutosave(autosaveSignature, saveConfig)

// Transparent-export detection: read the frame the live preview is ALREADY showing
// (engine.renderer.domElement) rather than rendering a fresh one just to test it.
// Space Type is one of the three surfaces whose renderer preserves alpha (see the
// `transparent`/bgColor Output controls + engine.setBackground) — Shader Studio and
// Gradient Studio were measured opaque during the embed work and don't get this toggle.
const exportAlphaAvailable = ref(false)
function detectAlpha(): boolean {
  if (!engine) return false
  // Render synchronously right before reading pixels back. The preview engine runs with
  // preserveDrawingBuffer: false (perf — see EngineOptions' doc), so the WebGL drawing
  // buffer is NOT guaranteed to still hold the last rAF-loop frame by the time a
  // user click (async relative to that loop) gets here: the browser can have already
  // cleared it to transparent black, which reads back as "has alpha" even for a fully
  // opaque scene — verified empirically (an unsynchronized read came back alpha 0
  // everywhere with the opaque background selected). renderFrameAt here is cheap (it's
  // exactly what the preview loop already calls every frame) and, critically, keeps the
  // render-then-read in one synchronous task with no `await` in between, so the buffer
  // can't be cleared out from under us.
  engine.renderFrameAt(previewT01, params)
  const src = engine.renderer.domElement
  if (!src.width || !src.height) return false
  const probe = document.createElement('canvas')
  probe.width = src.width
  probe.height = src.height
  const ctx = probe.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, probe.width, probe.height)
  return canvasHasAlpha(img)
}
// User's choice of transparent export.
const exportAlpha = ref(false)
// Re-detect alpha availability (and drop a now-stale "transparent" choice) whenever
// something that could change it happens: rebuild() (structural/effect edits, guarded
// there against baking) and the transparent/bgColor watch below. Replaces the old
// Render-menu-open hook — StudioFooterMenu (Task 2) owns its own open state now, so
// there's no "menu is about to open" moment left in this component to hang the check on.
function refreshExportAlpha() {
  exportAlphaAvailable.value = detectAlpha()
  if (!exportAlphaAvailable.value) exportAlpha.value = false
}

function closeEditor() { saveConfig(); emit('close') }

onMounted(async () => {
  if (!canvas.value) return
  // Restore saved config BEFORE building the engine so the first render is
  // already the user's authored state (not the defaults).
  const hadConfig = !!currentNode()?.data?.properties?.sailor_spaceType
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
  // NOTE: the live frame source for this node is registered by SpaceTypeNode.vue
  // (the always-mounted node), NOT here. The node stays mounted while this modal
  // is open, so its headless frame source covers downstream consumers in every
  // state. Registering here too would collide on the same node id and — worse —
  // this modal's unregister-on-close would delete the node's registration,
  // blanking a direct Space Type → Shader wire after one open/close.
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
watch([transparent, bgColor], () => { engine?.setBackground(transparent.value, bgColor.value); refreshExportAlpha() })
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
// Fold any `fills.<i>.<field>` overrides into one packed `fills` value (starting from
// the current live `params.fills`); pass non-fill keys through untouched.
function collapseFillOverrides(raw: Record<string, string | number>): Record<string, string | number> {
  const k = fillKey()
  if (!k) return raw
  const out: Record<string, string | number> = {}
  let fillsSer: unknown = (params as Record<string, unknown>)[k]
  let touched = false
  for (const [key, val] of Object.entries(raw)) {
    const s = parseFillSwatchKey(k, key)
    if (s) { fillsSer = writeFillSwatch(fillsSer, s.index, s.field, String(val)); touched = true }
    else out[key] = val
  }
  if (touched) out[k] = fillsSer as string
  return out
}
async function renderBlobWithOverrides(rawOverrides: Record<string, string | number>): Promise<Blob | null> {
  if (!engine) return null
  // Collapse fill-swatch overrides (`fills.0.a` …) into a single packed `fills`
  // override so the existing flat snapshot/apply/restore below round-trips one real
  // param instead of writing garbage top-level keys.
  const overrides = collapseFillOverrides(rawOverrides)
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
  // Render shader fills at full output resolution, unclamped, for this capture — see
  // engine.setBake's doc. Reset in `finally` so the live preview loop that resumes after
  // this function returns isn't stuck rendering fields at bake resolution/cost.
  engine.setBake(true)
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
    engine?.setBake(false)
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
    // Full-resolution, unclamped shader fields for this capture — see engine.setBake's doc.
    engine.setBake(true)
    rebuild()
    engine.renderFrame(0, params)
    const blob = await engine.frameToBlob(W.value, H.value)
    engine.setSize(W.value, H.value)
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    const [filename] = await uploadFrameBatch([blob], 'spacetype_img')
    if (filename) {
      // Stash a thumbnail on the node so its card shows a preview.
      const n = currentNode()
      if (n) {
        if (!n.data) n.data = {}
        if (!n.data.properties) n.data.properties = {}
        const prev = n.data.properties.sailor_spaceType || {}
        n.data.properties.sailor_spaceType = { ...prev, thumb: `/view?filename=${filename}&type=input` }
      }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:spaceTypeOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } finally {
    engine?.setBake(false)
    baking.value = false
    startPreview()
  }
}

// "Send to timeline": snapshot the studio's current state onto a new
// SpaceTypeClip via VueNodeCanvas's handleSpaceTypeOutput. Unlike
// generateImage/generateVideo this does NOT closeEditor() — sending is meant
// to be repeatable while iterating (send, tweak, send again, or use the
// timeline inspector's "Sync from node" once a clip already exists).
function sendToTimeline() {
  const snapshot: SpaceTypeState = {
    effectId: effectId.value,
    params: { ...params },
    gradientStops: gradientStops.map(s => ({ ...s })),
    post: { ...post },
    fps: fps.value,
    loopDuration: loopDuration.value,
    dimsKey: dimsKey.value,
    transparent: transparent.value,
    bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value,
    panY: panY.value,
  }
  window.dispatchEvent(new CustomEvent('sailor:spaceTypeOutput', {
    detail: { sourceNodeId: props.nodeId, nodeType: 'TimelineClip', state: snapshot },
  }))
}

/**
 * Bake the current Space Type state (frames at `fps`/`loopDuration`, full-res
 * unclamped shader fields) and encode it server-side to a video file under
 * input/. Shared by generateVideo() (dispatches a Video node onto the canvas)
 * and downloadVideoFile() (saves the file locally) so this frame-bake exists
 * in exactly one place. Callers own baking.value/stopPreview/startPreview and
 * engine.setBake(false) cleanup — this only does the bake + encode and either
 * returns the result or throws (a bake or encode failure look the same to a
 * caller: nothing to dispatch/download).
 */
async function bakeSpaceTypeVideo(): Promise<EncodeFramesResult | null> {
  if (!engine) return null
  await ensureEffectFonts()
  engine.setSize(W.value * BAKE_SS, H.value * BAKE_SS)
  engine.setFps(fps.value)
  engine.setLoopDuration(loopDuration.value)
  // Full-resolution, unclamped shader fields for every exported frame — see
  // engine.setBake's doc; every renderFrameAt call below inherits it.
  engine.setBake(true)
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
  // Gate on exportAlphaAvailable too, not just the checkbox: it's a stale UI value
  // once the menu closes, and the request-side flag is what actually changes the
  // server's encoder path (VP9/WebM instead of h264/mp4) — never send it unearned.
  const wantAlpha = exportAlpha.value && exportAlphaAvailable.value
  return encodeFrames({ frames: bake.frames, fps: fps.value, width: W.value, height: H.value, alpha: wantAlpha })
}

async function generateVideo() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    const encoded = await bakeSpaceTypeVideo()
    if (!encoded) return
    await recordAsset(activeTab.value?.projectUuid, 'video', encoded.filename)
    window.dispatchEvent(new CustomEvent('sailor:spaceTypeOutput', {
      detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: encoded.filename } },
    }))
    closeEditor()
  } catch (encErr) {
    console.error('[spacetype] video encode failed', encErr)
    alert('Video encode failed — make sure ComfyUI was restarted to load the encoder. See console.')
  } finally {
    engine?.setBake(false)
    baking.value = false
    startPreview()
  }
}

/** Download the still frame the preview is currently showing, at output resolution. */
async function downloadPng() {
  if (!engine) return
  const blob = await engine.frameToBlob(W.value, H.value)
  downloadBlobAsFile(blob, `spacetype_${Date.now()}.png`)
}

/** Same bake as generateVideo(), but saves the encoded file locally instead of
 *  dispatching a Video node onto the canvas. */
async function downloadVideoFile() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    const encoded = await bakeSpaceTypeVideo()
    if (!encoded) return
    const res = await fetch(`/view?${new URLSearchParams({ filename: encoded.filename, type: 'input' })}`)
    downloadBlobAsFile(await res.blob(), `spacetype_${Date.now()}.${encoded.ext}`)
  } catch (e) {
    console.error('[spacetype] video download failed', e)
  } finally {
    engine?.setBake(false)
    baking.value = false
    startPreview()
  }
}

// Cache of family+weight -> raw font bytes (or null on a fetch failure) so
// re-exporting the same node repeatedly doesn't re-fetch the file from Google Fonts
// every time. Keyed by family+weight only, NOT text: the raw bytes fetched here are
// the same regardless of what the piece says, so caching them is safe. Subsetting
// (below) depends on text and is intentionally NOT cached — it re-runs on every
// export in case the text changed since the last one, and it's a single fast local
// POST, not a network fetch of an external font host.
const fontBytesCache = new Map<string, ArrayBuffer | null>()

/** Base64-encode an ArrayBuffer without blowing the call stack on a ~200KB font file
 *  (String.fromCharCode(...bytes) spread would stack-overflow on the full array). */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Fetch the actual font FILE for family+weight as raw bytes. Reuses fontSourceUrl
 * (~/lib/scene3d/outlines) — the SAME resolution path the 3D Studio's text-extrude
 * primitive already uses to turn a `google:Family@weight` token into
 * `/api/scene3d/google-font-file`, a server proxy that forces Google Fonts to hand
 * back a raw, parseable TTF instead of the woff2 it serves real browsers — rather
 * than inventing a second font-fetch path here.
 *
 * Returns null on any failure (family Google doesn't have, network error, ...). The
 * caller degrades to `font: null` (viewer's system font) instead of failing the whole
 * export over a font that couldn't be fetched — see exportWebEmbed.
 */
async function fetchFontBytes(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}@${weight}`
  if (fontBytesCache.has(key)) return fontBytesCache.get(key)!
  try {
    const url = fontSourceUrl(`google:${family}@${weight}`)
    const res = await fetch(url)
    if (!res.ok) { fontBytesCache.set(key, null); return null }
    const buf = await res.arrayBuffer()
    fontBytesCache.set(key, buf)
    return buf
  } catch (e) {
    console.error('[space-type] embed export: font fetch failed', e)
    fontBytesCache.set(key, null)
    return null
  }
}

/**
 * POST a font (base64) + the piece's text to the ComfyUI-side `/sailor/font_subset`
 * route (comfy_extras/nodes_timeline.py's subset_font_bytes) and return the
 * subsetted font as base64. Subsets to `text`'s characters UNION the full basic-Latin
 * range — see that route's docstring and
 * docs/superpowers/plans/2026-08-04-embed-font-subsetting.md for why basic Latin is
 * kept even for text that doesn't use it (so the export doesn't foreclose rendering
 * text it wasn't built with, if it's ever wired to something dynamic).
 *
 * Returns null on ANY failure — network error, non-200, or a malformed body — and
 * NEVER throws: subsetting is a size optimization, not a correctness requirement, and
 * the caller falls back to the full font on null. Every failure path logs via
 * console.error first, though: a silent fallback here would leave someone staring at
 * a 296 KB export with no way to find out why it isn't ~40 KB.
 */
async function subsetFontBase64(fontB64: string, text: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch('/sailor/font_subset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ font: fontB64, text }),
    })
  } catch (e) {
    console.error('[space-type] embed export: font subset request failed, falling back to the full font', e)
    return null
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[space-type] embed export: font subset returned HTTP ${res.status}, falling back to the full font`, body)
    return null
  }
  let data: any
  try {
    data = await res.json()
  } catch (e) {
    console.error('[space-type] embed export: font subset response was not valid JSON, falling back to the full font', e)
    return null
  }
  if (!data || typeof data.font !== 'string' || !data.font) {
    console.error('[space-type] embed export: font subset response missing "font", falling back to the full font', data)
    return null
  }
  return data.font
}

/**
 * Fetch family+weight as a data: URI for inlining into a web embed export, subsetted
 * to `text`'s characters plus basic Latin (via subsetFontBase64/`/sailor/font_subset`)
 * whenever that succeeds. Falls back to the full, un-subsetted font on ANY subsetting
 * failure — the fetch from Google Fonts is a separate concern with its own fallback:
 * only a failure to fetch the font AT ALL (family/weight genuinely unavailable)
 * returns null here, in which case the caller degrades further to `font: null` (the
 * viewer's system font) — see exportWebEmbed.
 */
async function fetchFontDataUrl(family: string, weight: number, text: string): Promise<string | null> {
  const buf = await fetchFontBytes(family, weight)
  if (!buf) return null
  const fullB64 = bufferToBase64(buf)
  const subsetB64 = await subsetFontBase64(fullB64, text)
  return `data:font/ttf;base64,${subsetB64 ?? fullB64}`
}

// Mirrors GradientStudioSurface.vue's exportWebEmbed: in-flight guard (a double-click
// otherwise starts two full-resolution GL bakes and downloads two files), size shown
// BEFORE the download, and error styling distinct from success (embedErr).
//
// Space-Type-specific: `opts.alpha` defaults to the SAME `transparent` ref that
// already drives the video export (line ~152), so the two exports agree about
// background — Space Type is the first embed surface where caps.alpha is genuinely
// true (see spacetype.ts's own doc), so this is the first export where that choice
// does anything. And the font: the studio's live family/weight (resolved exactly like
// texOptsFromState/buildTexOpts do — same resolveFontFamily/fontHasWeightAxis calls)
// is fetched as real bytes, subsetted to the piece's text plus basic Latin via
// /sailor/font_subset, and inlined; a fetch failure degrades to `font: null` (viewer's
// system font), and a subsetting failure alone degrades to the full, un-subsetted font
// (still logged either way) rather than silently shipping a broken or oversized export.
async function exportWebEmbed() {
  if (embedding.value) return
  embedding.value = true
  embedErr.value = false
  embedMsg.value = 'Building…'
  try {
    if (!engine) throw new Error('Preview not ready')

    const family = resolveFontFamily(String(params.font))
    // Static families have no weight axis — pin to 400, matching texOptsFromState/
    // buildTexOpts, so a variable-only weight isn't faux-bolted onto a single cut.
    const weight = fontHasWeightAxis(family) ? Number(params.typeWeight ?? 700) : 400
    // The piece's text, same source texOptsFromState/texOpts() splits into lines —
    // what /sailor/font_subset keeps beyond basic Latin.
    const text = String(params.text ?? '')
    const dataUrl = await fetchFontDataUrl(family, weight, text)
    const font = dataUrl ? { family, weight, dataUrl } : null

    const embedConfig: SpaceTypeEmbedConfig = {
      effectId: effect.value.id,
      params: { ...params },
      opts: {
        width: W.value, height: H.value, fps: fps.value, loopDuration: loopDuration.value,
        alpha: transparent.value, bgColor: bgColor.value, projection: projection.value,
        panX: panX.value, panY: panY.value,
      },
      duration: loopDuration.value,
      font,
      gradientStops: gradientStops.map(g => ({ ...g })),
      post: { ...post },
    }

    const html = await exportEmbedHtml({
      kind: 'spacetype',
      config: embedConfig,
      duration: loopDuration.value,
      width: W.value,
      height: H.value,
      // Without this, the exported PAGE's own html/body background stays opaque
      // black (bundle.ts's `bg` var) even though the ENGINE renders real alpha —
      // the two exports would agree on nothing. Space Type is the first surface
      // where surface.caps.alpha is genuinely true, so this is the first export
      // where exportEmbedHtml's `transparent` option does anything at all (see
      // exportEmbedHtml: `transparent = !!opts.transparent && surface.caps.alpha`).
      transparent: transparent.value,
    })

    // Size is shown BEFORE the download, not discovered later. A missing font is
    // stated plainly too — never a silently-wrong typeface with no visible sign.
    const kb = (new Blob([html]).size / 1024).toFixed(0)
    embedMsg.value = font
      ? `${kb} KB — downloading…`
      : `${kb} KB — downloading… ("${family}" unavailable, will use the viewer's system font)`
    await nextTick()
    downloadEmbed('sailor-spacetype-embed.html', html)
    embedMsg.value = font
      ? `Downloaded — ${kb} KB`
      : `Downloaded — ${kb} KB ("${family}" unavailable — piece uses the viewer's system font)`
  } catch (err) {
    console.error('[SpaceType] embed export failed:', err)
    embedErr.value = true
    embedMsg.value = err instanceof Error ? err.message : 'Export failed'
  } finally {
    embedding.value = false
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
        <div v-else-if="frozenFieldCount > 0"
             class="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-amber-400/30 bg-black/70 px-3 py-2 text-[11px] text-amber-200/90">
          {{ frozenFieldCount }} shader fill{{ frozenFieldCount > 1 ? 's' : '' }} frozen — too many live shader
          fields at once (limit {{ LIVE_FIELD_CEILING }}). Remove a shader fill for full motion.
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
    <!-- The vibe AI input docks under the preview, centred, like every other studio's
         agent bar — instead of floating at the top of the controls column. Its proposal
         (chips / keep / revert) rides with it there. -->
    <template #agentBar>
      <VibeControlBar
        :busy="vibeBusy"
        :proposal="vibeProposal"
        @submit="onVibe"
        @keep="onVibeKeep"
        @revert="onVibeRevert"
        @focus-control="onVibeFocus"
      />
    </template>
    <template #controls>
      <div class="flex shrink-0 gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="inspectorTab === 'design' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'design'">Design</button>
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="inspectorTab === 'motion' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'motion'">Motion</button>
      </div>
      <p v-if="inspectorTab === 'motion' && !motionControlCount" class="px-1 pt-2 text-[11px] text-white/40">
        This effect has no motion parameters.
      </p>
      <div v-show="inspectorTab === 'design'" class="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
          <!-- Effect: the hero picker of the pane — it chooses everything below it, so it
               earns its prominence through SIZE alone (taller, larger headline type), NOT a
               different fill or corner. Same 5% fill and 6px radius as every other control;
               "Effect" is a quiet caption and the effect NAME is the headline. Launcher. -->
          <button type="button" @click="showEffectGallery = true"
                  class="group flex h-10 w-full items-center justify-between gap-2 rounded-[6px] bg-white/[0.05] px-2.5 text-left transition-colors hover:bg-white/[0.08]">
            <span class="text-[11px] text-white/72">Effect</span>
            <span class="flex min-w-0 items-center gap-2">
              <span class="truncate text-[13px] font-medium text-white/95">{{ effect.label }}</span>
              <span class="inline-block shrink-0 rotate-90 text-[13px] text-white/45 group-hover:text-white/70">›</span>
            </span>
          </button>
          <!-- One uniform button group, left-aligned and wrapping — not two rows split
               justify-between / justify-end. Filled, not bordered, to match the rows. -->
          <div class="flex flex-wrap gap-1.5">
            <button type="button" @click="applyEffectDefaults"
                    class="rounded-[6px] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white/90">
              Reset to defaults
            </button>
            <button type="button" @click="makeAsDefault" :disabled="savingDefault"
                    class="rounded-[6px] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white/90 disabled:opacity-40">
              {{ savingDefault ? 'Saving…' : 'Make as default' }}
            </button>
            <button v-if="SHOW_THUMB_CAPTURE" type="button" @click="captureThumbnail" :disabled="capturingThumb"
                    class="rounded-[6px] bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white/90 disabled:opacity-40">
              {{ capturingThumb ? 'Capturing…' : 'Capture thumbnail' }}
            </button>
          </div>
        </div>
        <StudioSection
          v-for="section in sections" :key="section.name"
          v-show="sectionVisible(section)"
          :title="section.name"
          :open="(section.name === 'Motion' && inspectorTab === 'motion') || openSections[section.name]"
        >
          <div class="space-y-3">
            <div
              v-for="c in section.controls" :key="c.key"
              v-show="!(c.key === 'typeWeight' && !fontIsVariable) && controlIsVisible(c)"
              :data-control-key="c.key"
              :class="{ 'rounded-md ring-1 ring-amber-400/30 px-1 -mx-1': vibeMoved.has(c.key) }"
              data-control class="text-xs"
              @contextmenu.prevent="openVarMenu($event, c)">
              <!-- No external caption for slider / font / single text: each self-labels inside
                   its own row (StudioSlider, FontPicker's row mode, StudioRow), carrying the
                   variable glyph there. textList still shows it — a list needs a header. -->
              <label v-if="!['slider', 'font', 'text'].includes(c.kind)" class="mb-1 flex items-center gap-1.5 text-white/60 group">
                <span>{{ c.label }}</span>
                <VariableGlyph
                  v-if="controlKindToVariableType(c.kind) !== null"
                  :bound="boundColumnFor(c.key)"
                  @promote="promote(controlDesc(c), params[c.key] as string | number)"
                  @menu="(e: MouseEvent) => openVarMenu(e, c)"
                />
              </label>
              <span v-if="vibeMoved.has(c.key) && vibeSnapshot && c.kind !== 'slider'" class="ml-1 text-[10px] text-amber-400/80">was {{ fmt(vibeSnapshot[c.key]) }}</span>
              <StudioSlider v-if="c.kind === 'slider'" :label="c.label"
                            :min="Number(c.min ?? 0)" :max="Number(c.max ?? 1)" :step="Number(c.step ?? 1)"
                            :default="Number(c.default ?? 0)"
                            :model-value="Number(params[c.key])"
                            :bindable="controlKindToVariableType(c.kind) !== null"
                            :bound="boundColumnFor(c.key)"
                            @update:model-value="(v: number) => { params[c.key] = v; onEdit(c.key, v) }"
                            @promote="promote(controlDesc(c), Number(params[c.key]))"
                            @menu="(e: MouseEvent) => openVarMenu(e, c)" />
              <!-- Single text: a bindable value-right row (RowText), same shape as every
                   other control. StudioRow carries the glyph + bound pink state itself, so
                   the old external-caption + raw <input> + separate bound block all collapse
                   into this. -->
              <StudioRow
                v-else-if="c.kind === 'text'"
                :spec="{ key: c.key, label: c.label, kind: 'text', default: '', group: '' } as ControlSpec"
                :model-value="String(params[c.key])"
                :bound="boundColumnFor(c.key)"
                :bindable="true"
                @update:model-value="(v) => { params[c.key] = String(v); rebuild(); onEdit(c.key, String(v)) }"
                @promote="promote(controlDesc(c), params[c.key] as string | number)"
                @menu="(e: MouseEvent) => openVarMenu(e, c)"
                @go-to-collection="goToCollection"
              />
              <div v-else-if="c.kind === 'textList' && boundColumnFor(c.key)" class="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
                <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ boundColumnFor(c.key) }}</span>
                <button type="button" @click="goToCollection"
                        class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
              </div>
              <template v-else-if="c.kind === 'textList'">
                <div v-for="(_, i) in textLines" :key="i" data-row
                     class="mb-1 flex items-center gap-1 rounded transition-shadow"
                     :class="drag.kind === 'text' && drag.over === i && drag.from !== i ? 'ring-1 ring-white/40' : ''"
                     @dragover="dragOver('text', i, $event)" @drop="dropRow('text', i)">
                  <span draggable="true" @dragstart="dragStart('text', i, $event)" @dragend="dragEnd"
                        class="shrink-0 cursor-grab px-0.5 text-white/25 hover:text-white/60 active:cursor-grabbing" title="Drag to reorder" aria-label="Drag to reorder">
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="4" r="1" /><circle cx="7.5" cy="4" r="1" /><circle cx="2.5" cy="8" r="1" /><circle cx="7.5" cy="8" r="1" /><circle cx="2.5" cy="12" r="1" /><circle cx="7.5" cy="12" r="1" /></svg>
                  </span>
                  <input type="text" v-model="textLines[i]"
                         class="h-7 w-full rounded-[6px] bg-white/[0.05] px-2.5 text-[11px] text-white/90 outline-none transition-colors hover:bg-white/[0.07] focus:bg-white/[0.10]" />
                  <button v-if="textLines.length > 1" type="button" @click="removeTextRow(i)" aria-label="Remove text"
                          class="shrink-0 rounded-[6px] px-1.5 text-white/35 hover:bg-white/10 hover:text-white/80">−</button>
                </div>
                <button type="button" @click="addTextRow"
                        class="mt-0.5 self-start rounded-[6px] px-2 py-1 text-[11px] text-white/50 hover:bg-white/10 hover:text-white/80">+ Add text</button>
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
                                    @update:model-value="(v: string) => setFillType(f, v as FillType)" />
                      <button v-if="fills.length > 1" type="button" @click="removeFill(i)" aria-label="Remove fill"
                              class="shrink-0 rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                      </button>
                    </div>
                    <!-- Colours as rows, not caption-over-swatch tiles in a horizontal strip.
                         The A/B pair is meaningless for a shader fill (its look comes from the
                         nested input fill below), so it's hidden rather than shown inert; Text
                         is an independent solid colour some effects use regardless of the fill
                         pattern (see Fill's own doc), so it always shows. Each is a bindable
                         colour row — the variable glyph + pink bound row is StudioRow's now,
                         which is what FillSwatch used to hand-roll. -->
                    <div class="mt-2 space-y-1.5 pl-6">
                      <StudioColorField
                        v-if="f.type !== 'shader'"
                        :label="fillNeedsB(f) ? 'Color 1' : 'Fill'"
                        :model-value="f.a"
                        :bound="boundColumnFor(swatchKey(i, 'a'))"
                        :bindable="true"
                        @update:model-value="(v: string) => { f.a = v }"
                        @promote="promote(swatchDesc(i, 'a', fillNeedsB(f) ? 'Color 1' : 'Fill'), f.a)"
                        @menu="(e: MouseEvent) => openVarMenuDesc(e, swatchDesc(i, 'a', fillNeedsB(f) ? 'Color 1' : 'Fill'), f.a)"
                        @go-to-collection="goToCollection"
                      />
                      <StudioColorField
                        v-if="f.type !== 'shader' && fillNeedsB(f)"
                        label="Color 2"
                        :model-value="f.b"
                        :bound="boundColumnFor(swatchKey(i, 'b'))"
                        :bindable="true"
                        @update:model-value="(v: string) => { f.b = v }"
                        @promote="promote(swatchDesc(i, 'b', 'Color 2'), f.b)"
                        @menu="(e: MouseEvent) => openVarMenuDesc(e, swatchDesc(i, 'b', 'Color 2'), f.b)"
                        @go-to-collection="goToCollection"
                      />
                      <StudioColorField
                        label="Text"
                        :model-value="f.textColor"
                        :bound="boundColumnFor(swatchKey(i, 'textColor'))"
                        :bindable="true"
                        @update:model-value="(v: string) => { f.textColor = v }"
                        @promote="promote(swatchDesc(i, 'textColor', 'Text'), f.textColor)"
                        @menu="(e: MouseEvent) => openVarMenuDesc(e, swatchDesc(i, 'textColor', 'Text'), f.textColor)"
                        @go-to-collection="goToCollection"
                      />
                    </div>
                    <!-- pattern controls (only the ones this type uses) -->
                    <div v-if="fillHasAngle(f) || fillHasDensity(f)" class="mt-2.5 space-y-1.5 pl-6">
                      <StudioSlider v-if="fillHasAngle(f)" v-model="f.angle" :label="f.type === 'stripes' ? 'Angle' : 'Fade angle'" :min="0" :max="180" :step="5" />
                      <StudioSlider v-if="fillHasDensity(f)" v-model="f.density" label="Density" :min="1" :max="32" :step="1" />
                    </div>
                    <!-- shader fill: effect/params/anchor/speed + nested input fill -->
                    <div v-if="f.type === 'shader'" class="mt-2.5 pl-6">
                      <ShaderFillEditor :model-value="f.shader ?? DEFAULT_SHADER_SPEC" @update:model-value="(v: ShaderSpec) => { f.shader = v }" />
                    </div>
                  </div>
                  <button type="button" @click="addFill"
                          class="w-full rounded border border-dashed border-white/15 py-1.5 text-[11px] text-white/50 hover:border-white/30 hover:text-white/80">+ Add fill</button>
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
              <!-- Font is excluded here: its bound state now lives inside FontPicker's row
                   (like a bound colour), so it does not need this shared pink block. -->
              <div v-else-if="(c.kind === 'color' || c.kind === 'select') && boundColumnFor(c.key)"
                   class="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
                <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ boundColumnFor(c.key) }}</span>
                <button type="button" @click="goToCollection"
                        class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
              </div>
              <StudioColor v-else-if="c.kind === 'color'" :model-value="String(params[c.key])"
                           @update:model-value="(val: string) => { params[c.key] = val; rebuild(); onEdit(c.key, val) }" />
              <StudioSegmented v-else-if="c.kind === 'select' && (c.options?.length ?? 0) <= 3"
                               :options="c.options ?? []" :model-value="String(params[c.key])"
                               @update:model-value="(v: string) => { params[c.key] = v; rebuild(); onEdit(c.key, v) }" />
              <StudioSelect v-else-if="c.kind === 'select'"
                            :options="c.options ?? []" :model-value="String(params[c.key])"
                            @update:model-value="(v: string) => { params[c.key] = v; rebuild(); onEdit(c.key, v) }" />
              <template v-else-if="c.kind === 'font'">
                <FontPicker
                  :model-value="String(params[c.key])"
                  :label="c.label"
                  :bound="boundColumnFor(c.key)"
                  @select="(p) => onFontSelect(c.key, p)"
                  @promote="promote(controlDesc(c), params[c.key] as string | number)"
                  @menu="(e: MouseEvent) => openVarMenu(e, c)"
                  @go-to-collection="goToCollection"
                />
                <div v-if="varAxisList.length" class="mt-2 space-y-2.5">
                  <StudioSlider v-for="a in varAxisList" :key="a.tag"
                                :model-value="fontAxes[a.tag] ?? a.default" @update:model-value="(v: number) => { fontAxes[a.tag] = v }"
                                :label="a.label" :min="a.min" :max="a.max" :step="a.step" :default="a.default" />
                </div>
                <p v-if="!fontIsVariable" class="mt-1 text-[10px] text-white/40">Static font — weight axis unavailable.</p>
              </template>
            </div>

            <template v-if="section.name === 'Camera'">
              <!-- Camera controls: these were hand-written as a raw <select> and raw range
                   inputs (the two-line label-above idiom the rest of the studios retired).
                   Now the same StudioSelect / StudioSlider rows as every other control. -->
              <div data-control>
                <StudioSelect label="Projection" v-model="projection" :options="['perspective', 'isometric']" />
              </div>
              <div data-control>
                <StudioSlider label="Pan X" v-model="panX" :min="-1" :max="1" :step="0.01" :bindable="false" />
              </div>
              <div data-control>
                <StudioSlider label="Pan Y" v-model="panY" :min="-1" :max="1" :step="0.01" :bindable="false" />
              </div>
            </template>

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
              <div v-if="!transparent" data-control>
                <StudioColorField label="Background color" v-model="bgColor" />
              </div>
            </template>
          </div>
        </StudioSection>

        <!-- Shared post-processing — applies to every effect, live + in exports. -->
        <StudioSection v-show="inspectorTab === 'design'" title="Post" :open="openSections.Post">
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
    <!-- StudioActionsFooter lives in the modal's reserved bottom-right actions footer
         (shell #actions), like every other studio — there is no Save button; saving is
         automatic and debounced (see useStudioAutosave above). -->
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { saving: autoSaving, saved: autoSaved, error: embedErr ? embedMsg : null, notice: embedErr ? null : embedMsg },
        downloads: [
          { label: 'Download PNG', onClick: downloadPng },
          { label: 'Download video', onClick: downloadVideoFile, busy: baking },
          { label: 'Export embed', onClick: exportWebEmbed, busy: embedding },
        ],
        canvas: [
          { label: 'As image', onClick: generateImage, busy: baking },
          { label: 'As video', onClick: generateVideo, busy: baking },
          ...(exportAlphaAvailable ? [{ label: 'As video (transparent)', subtitle: 'WebM with real transparency · Safari can\'t play it', onClick: () => { exportAlpha = true; generateVideo() } }] : []),
          { label: 'Send to timeline', onClick: sendToTimeline },
        ],
      }" />
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
