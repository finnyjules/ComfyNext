<script setup lang="ts">
// Full-screen editor for the Shape Studio node (faceted flat-shape generator). Modeled
// directly on GradientStudioSurface.vue: StudioModalShell chrome, a requestAnimationFrame
// preview loop, mount/dispose of the studio's own engine, and the exact same
// recordAsset → sailor:*StudioOutput emit used for the image output path. Shape Studio is
// simpler than Gradient/Space Type (no agent tuner, no collection var-bindings, no video
// export) so this file is deliberately smaller — three.js is the whole renderer, there's
// no 2D canvas/shader fallback.
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Dices, Lock, Unlock } from 'lucide-vue-next'
import { ShapeEngine } from '~/lib/shapefx/engine'
import { DEFAULT_CONFIG, mergeConfig, type ShapeConfig } from '~/lib/shapefx/config'
import { reroll } from '~/lib/shapefx/randomize'
import { paletteFor } from '~/lib/shapefx/color'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { HARMONY_TYPES, HARMONY_LABELS, toStops } from '~/lib/color/harmony'
import { hexToOklch, oklchToHex } from '~/lib/color/convert'
import { FILL_TYPES } from '~/lib/spacetype/fillTile'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import FillSwatch from '~/components/vue-canvas/studio/FillSwatch.vue'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { makeConfigParams } from '~/lib/agent/configParams'
import { shapeAgentControls, SHAPE_GUIDANCE } from '~/lib/shapefx/agentControls'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { typeCompatible } from '~/lib/collection/bindables'
import { addSweepRows } from '~/lib/collection/model'
import { COLLECTION_PROP, VARS_TYPE, type CollectionColumn, type CollectionData } from '~/lib/collection/types'
import { effectiveColumns, makeLookupResolver } from '~/lib/collection/lookup'

// `nodes` is optional (defaults to []) so this surface can be smoke-tested standalone
// (see the dev lab page) before Task 10 wires it into VueNodeCanvas the way every other
// studio surface is wired — as `nodeId` + the live `nodes` array so the editor can find
// and persist onto its own node (`currentNode()` below, same pattern as Gradient/Space
// Type/Shader/Texture/LipSync). Without `nodes`, load/save just no-op.
const props = withDefaults(defineProps<{ nodeId: string; nodes?: any[]; edges?: any[] }>(), { nodes: () => [] })
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills as the current project's assets (Assets panel) — identical
// composables Gradient/Space Type use for their image output.
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

function currentNode(): any | undefined {
  return props.nodes?.find((n: any) => String(n?.id) === String(props.nodeId))
}

// ── canvas dimensions (NOT part of ShapeConfig — mirrors Space Type's separate W/H/dimsKey
// persisted alongside its effect config rather than inside it) ─────────────────────────────
const ASPECTS: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 3 / 2, '2:3': 2 / 3 }
const ASPECT_OPTIONS = Object.keys(ASPECTS)

// ── config (single source of truth) — hydrate synchronously from the node's persisted
// blob if present, else DEFAULT_CONFIG. mergeConfig deep-defends against partial/old/junk
// JSON (see Task 1's config.ts), so this is safe even if the shape schema grows later.
const persisted = currentNode()?.data?.properties?.sailor_shapeStudio as
  { config?: unknown; canvasW?: number; canvasH?: number; aspectKey?: string
    orbit?: { yaw?: number; pitch?: number; zoom?: number } } | undefined

const config = ref<ShapeConfig>(mergeConfig(persisted?.config))
const aspectKey = ref<string>(persisted?.aspectKey && ASPECTS[persisted.aspectKey] ? persisted.aspectKey : '1:1')
const canvasW = ref<number>(typeof persisted?.canvasW === 'number' ? persisted.canvasW : 1024)
const canvasH = ref<number>(
  typeof persisted?.canvasH === 'number' ? persisted.canvasH : Math.round(1024 / (ASPECTS[aspectKey.value] ?? 1)),
)
// Only the aspect SELECT drives H from W (a convenience) — editing W/H directly is left
// free-form (no "Custom" sentinel dance like Space Type's DIMS map); simplest v1 that still
// satisfies "aspect-ratio select, width, height" as three independent controls.
watch(aspectKey, (k) => { canvasH.value = Math.max(16, Math.round(canvasW.value / (ASPECTS[k] ?? 1))) })

function saveConfig() {
  const n = currentNode(); if (!n) return
  n.data ||= {}; n.data.properties ||= {}
  n.data.properties.sailor_shapeStudio = {
    config: JSON.parse(JSON.stringify(config.value)),
    canvasW: canvasW.value, canvasH: canvasH.value, aspectKey: aspectKey.value,
    // Persist the interactive camera so the node card's headless Render bakes at the
    // SAME framing the user left the editor on (orbit lives outside ShapeConfig,
    // alongside canvas dims, since it's view state not shape state).
    orbit: { yaw: orbit.yaw, pitch: orbit.pitch, zoom: orbit.zoom },
  }
}
function closeEditor() {
  try { saveConfig() } catch (e) { console.error('[shape-studio] saveConfig failed', e) }
  emit('close')
}

// ── in-product agent — "tune" the shape in natural language, following
// GradientStudioSurface's useStudioAgent wiring exactly. Shape has no
// per-layer state, so the second arg to makeConfigParams is a constant.
const { getLocalSetting } = useLocalSettings()
const agentParams = makeConfigParams(() => config.value, () => 0)
const activeAgentControls = computed(() => shapeAgentControls(config.value))
const shapeAgent = useStudioAgent({
  controls: () => activeAgentControls.value, params: agentParams, label: () => 'Shape studio',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  guidance: () => SHAPE_GUIDANCE,
})

// ── Collections variable binding (Slice 2a) — same recipe as Gradient/Texture.
// `studioControls` mirrors what the agent tuner already offers (via
// `controlsForStudio`, loaded once since the composable wants a synchronous
// accessor) purely for the bind-menu's control descriptions (label/kind/min/
// max/step), matched by dotted key against SHAPE_CONTROLS.
const studioControls = ref<StudioControlDesc[]>([])
onMounted(async () => { studioControls.value = await controlsForStudio(currentNode()) })

// The SAME dotted-path proxy the canvas agent tuner reads/writes — reused here
// so onEdit/promote/unbind's "live value" reads and applyParam's writes
// address identical keys. Writing through this proxy mutates `config`
// directly, so the surface's existing `deep` watcher on `config` re-renders
// the preview — no extra watcher needed.
const paramsProxy = makeConfigParams(() => config.value, () => 0)
const { boundColumnFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes ?? [], edges: () => props.edges ?? [] },
)

// Wired collection lookup (studio -> collection) for the "Bind to" submenu.
const wiredColumns = computed<CollectionColumn[]>(() => {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((e: any) => String(e.target) === String(props.nodeId) && e?.data?.dataType === VARS_TYPE)
  if (!edge) return []
  const colNode = (props.nodes ?? []).find((n: any) => String(n.id) === String(edge.source))
  const c = colNode?.data?.properties?.[COLLECTION_PROP]
  if (!c) return []
  return effectiveColumns(c, makeLookupResolver(props.nodes ?? []))
})

// Wired collection NODE (not just its columns) — the sweep flow needs to
// mutate the actual CollectionData object once the popover's Apply fires.
function findWiredCollectionNode(): any | null {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((e: any) => String(e.target) === String(props.nodeId) && e?.data?.dataType === VARS_TYPE)
  if (!edge) return null
  return (props.nodes ?? []).find((n: any) => String(n.id) === String(edge.source)) ?? null
}

// Wired collection node id — shared by the var-menu's "Go to collection"
// item and the FillSwatch "edit in table" click (mirrors Texture/Space Type's
// goToCollection helper; Shape's fill.a/fill.b swatches need it since
// FillSwatch's bound state renders an "edit" affordance).
function wiredCollectionNodeId(): string | null {
  const edgeList = props.edges ?? []
  const edge = edgeList.find((ed: any) => String(ed.target) === String(props.nodeId) && ed?.data?.dataType === VARS_TYPE)
  return edge ? String(edge.source) : null
}
function goToCollection() {
  const nodeId = wiredCollectionNodeId()
  if (nodeId) window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId } }))
}

// Sweep popover state — opened from the "Sweep…" chip menu item on a bound
// control; on Apply, turns the entered values into sweep rows on the wired
// collection and hands off to the drawer + a follow-up run event (copied
// verbatim from GradientStudioSurface.vue).
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
  window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: String(colNode.id) } }))
  window.dispatchEvent(new CustomEvent('sailor:runSweepRows', {
    detail: { collectionNodeId: String(colNode.id), rowIds: added.map(r => r.id), targetNodeId: props.nodeId },
  }))
}

// Copied verbatim from GradientStudioSurface.vue's openVarMenu (Texture's copy
// is byte-identical too, so this is a third, known-stable instance of the
// same block — not a new invention).
const varMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
function openVarMenu(e: MouseEvent, control: StudioControlDesc) {
  const type = controlKindToVariableType(control.kind)
  if (type === null) return
  const liveValue = paramsProxy[control.key] as string | number
  const bound = boundColumnFor(control.key)
  const items: MenuItem[] = []
  if (!bound) {
    items.push({ label: 'Turn into variable', action: () => promote(control, liveValue) })
    const compatCols = wiredColumns.value.filter(col => typeCompatible(type, col.type))
    if (compatCols.length) {
      items.push({
        label: 'Bind to',
        children: compatCols.map(col => ({
          label: col.label,
          action: () => window.dispatchEvent(new CustomEvent('sailor:bindControl', {
            detail: { nodeId: props.nodeId, path: `params.${control.key}`, columnKey: col.key },
          })),
        })),
      })
    }
  } else {
    items.push({
      label: 'Go to collection',
      action: () => {
        const edgeList = props.edges ?? []
        const edge = edgeList.find((ed: any) => String(ed.target) === String(props.nodeId) && ed?.data?.dataType === VARS_TYPE)
        if (edge) window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: String(edge.source) } }))
      },
    })
    items.push({ label: 'Sweep…', action: () => { sweepPopover.value = { control, anchor: { x: e.clientX, y: e.clientY } } } })
    items.push({ divider: true })
    items.push({ label: 'Unbind', action: () => unbind(control.key, liveValue) })
  }
  varMenu.value = { x: e.clientX, y: e.clientY, items }
}

// ── enum fields → string proxies ────────────────────────────────────────────────────────
// StudioSelect/StudioSegmented's v-model is typed `string`; ShapeConfig's mode/primitive/
// projection/harmony/rule/fillMode fields are narrower string-literal unions. A thin
// computed proxy per field keeps the template `v-model`s type-clean without widening the
// config schema itself.
function enumProxy<T extends string>(get: () => T, set: (v: T) => void) {
  return computed<string>({ get, set: (v: string) => set(v as T) })
}
const shapeModeProxy = enumProxy(() => config.value.shape.mode, v => { config.value.shape.mode = v })
const primitiveProxy = enumProxy(() => config.value.shape.primitive, v => { config.value.shape.primitive = v })
const projectionProxy = enumProxy(() => config.value.shape.projection, v => { config.value.shape.projection = v })
const coloringProxy = enumProxy(() => config.value.palette.coloring, v => { config.value.palette.coloring = v })
const directionProxy = enumProxy(() => config.value.palette.direction, v => { config.value.palette.direction = v })
const fillTypeProxy = enumProxy(() => config.value.fill.type, v => { config.value.fill.type = v })
const fillModeProxy = enumProxy(() => config.value.fillMode, v => { config.value.fillMode = v })

const PRIMITIVE_OPTIONS = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron']

// ── locks ────────────────────────────────────────────────────────────────────────────────
function toggleLock(key: 'shape' | 'palette' | 'style') { config.value.locks[key] = !config.value.locks[key] }
function locked(key: 'shape' | 'palette' | 'style') { return !!config.value.locks[key] }

// ── re-roll ──────────────────────────────────────────────────────────────────────────────
function rerollConfig() { config.value = reroll(config.value) }

// ── Palette section — native, parametric. The four fields (harmony + hue/sat/light) ARE
// the palette; everything here reads/writes them directly, so what you see is what renders.
// Base color is a two-way shortcut: it maps a single hex to hue/sat/light (the exact inverse
// of paletteFor()'s hue/sat/light → OKLCH seed), and reads back as that seed color.
const baseColorHex = computed<string>({
  get: () => {
    const { baseHue, saturation, lightness } = config.value.palette
    return oklchToHex(0.25 + (lightness / 100) * 0.6, (saturation / 100) * 0.22, baseHue)
  },
  set: (hex: string) => {
    const [L, C, H] = hexToOklch(hex)
    config.value.palette.baseHue = Math.round(((H % 360) + 360) % 360)
    config.value.palette.saturation = Math.round(Math.max(0, Math.min(100, (C / 0.22) * 100)))
    config.value.palette.lightness = Math.round(Math.max(0, Math.min(100, ((L - 0.25) / 0.6) * 100)))
  },
})
// Live previews of the ACTUAL output: the discrete harmony swatches, and the interpolated
// ramp that prismatic/smooth/faceted paint onto the shape.
const paletteSwatches = computed(() => paletteFor(config.value))
const paletteRampCss = computed(() =>
  `linear-gradient(to right, ${toStops(paletteFor(config.value), 8).map(s => s.color).join(', ')})`)

// ── Fill section (surface mode) — mirrors Space Type's fillNeedsB/fillHasAngle/
// fillHasDensity helpers for the same FillType union.
const fillNeedsB = computed(() => config.value.fill.type !== 'solid')
const fillHasAngle = computed(() => config.value.fill.type === 'ombre' || config.value.fill.type === 'stripes')
const fillHasDensity = computed(() => ['grid', 'checkerboard', 'stripes', 'qr'].includes(config.value.fill.type))

// ── Style section: background transparency toggle (StyleParams.background is either a hex
// or the literal 'transparent') — remember the last real color so toggling transparency
// off restores it instead of landing on black.
const lastBgColor = ref(config.value.style.background === 'transparent' ? DEFAULT_CONFIG.style.background : config.value.style.background)
const bgTransparent = computed({
  get: () => config.value.style.background === 'transparent',
  set: (v: boolean) => {
    if (v) {
      if (config.value.style.background !== 'transparent') lastBgColor.value = config.value.style.background
      config.value.style.background = 'transparent'
    } else {
      config.value.style.background = lastBgColor.value
    }
  },
})
const bgColorProxy = computed({
  get: () => (config.value.style.background === 'transparent' ? lastBgColor.value : config.value.style.background),
  set: (v: string) => { config.value.style.background = v; lastBgColor.value = v },
})

// ── grain overlay (CSS, NOT baked by the engine) ────────────────────────────────────────
// A tiled feTurbulence noise data-URI, opacity-driven by config.style.grain/100, laid over
// the canvas via `mix-blend-mode: overlay`. previewBox tracks the canvas's on-screen CSS
// box every frame (same technique as Gradient's mesh-handle overlay) so the noise div lines
// up exactly regardless of the preview's dpr-scaled backing size.
const NOISE_BG = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/></filter><rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")'
const previewBox = ref({ left: 0, top: 0, w: 0, h: 0 })
const grainStyle = computed(() => ({
  opacity: String(config.value.style.grain / 100),
  backgroundImage: NOISE_BG,
  backgroundSize: '160px 160px',
  mixBlendMode: 'overlay' as const,
  left: `${previewBox.value.left}px`, top: `${previewBox.value.top}px`,
  width: `${previewBox.value.w}px`, height: `${previewBox.value.h}px`,
}))

// ── distortion (CSS/SVG filter, also NOT baked by the engine) ──────────────────────────
// Documented choice: an SVG feDisplacementMap filter (feTurbulence noise as the
// displacement source) applied to the canvas via CSS `filter: url(#...)`, scaled by
// config.style.distortion/100. This gives a genuine warped-glass look with no engine
// changes, unlike a plain CSS `filter: blur()` stand-in which wouldn't read as "distortion"
// at all. Skipped entirely (filter: none) at distortion=0 so there's no per-frame SVG
// filter cost when unused.
const distortFilterId = computed(() => `shape-distort-${String(props.nodeId).replace(/[^a-zA-Z0-9_-]/g, '_')}`)
const distortionScale = computed(() => (config.value.style.distortion / 100) * 45)
const distortionFilter = computed(() => (config.value.style.distortion > 0 ? `url(#${distortFilterId.value})` : 'none'))

// ── preview: engine mount + rAF loop + orbit ────────────────────────────────────────────
const canvas = ref<HTMLCanvasElement | null>(null)
const webglOk = ref(true)
const exporting = ref(false)
// Short-lived, user-visible failure notice for the Export/Import actions (network down,
// upload endpoint 500, unreadable/invalid settings JSON). Without this the button just
// silently reverts from "Exporting…" and the console.error is invisible to the user.
const actionError = ref('')
let actionErrorTimer: ReturnType<typeof setTimeout> | null = null
function setActionError(msg: string) {
  actionError.value = msg
  if (actionErrorTimer) clearTimeout(actionErrorTimer)
  actionErrorTimer = setTimeout(() => { actionError.value = '' }, 5000)
}
let engine: ShapeEngine | null = null
let raf = 0
let rebuildRaf = 0
let lastW = 0, lastH = 0
// Hydrate the camera from the persisted view (falls back to the default framing).
// Keep these defaults in sync with ShapeStudioNode's DEFAULT_ORBIT.
const orbit = reactive({
  yaw: persisted?.orbit?.yaw ?? 0.6,
  pitch: persisted?.orbit?.pitch ?? 0.32,
  zoom: persisted?.orbit?.zoom ?? 1,
})
const PREVIEW_MAX = 620

function previewDims() {
  const el = canvas.value
  const ar = Math.max(0.1, canvasW.value / Math.max(1, canvasH.value))
  const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2)
  const wrap = el?.parentElement
  const availW = wrap?.clientWidth || PREVIEW_MAX
  const availH = wrap?.clientHeight || Math.round(PREVIEW_MAX / ar)
  let cssW = Math.min(availW, PREVIEW_MAX)
  let cssH = cssW / ar
  if (cssH > availH) { cssH = availH; cssW = availH * ar }
  cssW = Math.max(1, Math.round(cssW)); cssH = Math.max(1, Math.round(cssH))
  return { cssW, cssH, w: Math.max(1, Math.round(cssW * dpr)), h: Math.max(1, Math.round(cssH * dpr)) }
}

function frame() {
  const el = canvas.value
  if (el && engine) {
    const { cssW, cssH, w, h } = previewDims()
    el.style.width = `${cssW}px`
    el.style.height = `${cssH}px`
    if (w !== lastW || h !== lastH) { engine.setSize(w, h); lastW = w; lastH = h }
    engine.render(orbit)
    previewBox.value = { left: el.offsetLeft, top: el.offsetTop, w: el.clientWidth, h: el.clientHeight }
  }
  raf = requestAnimationFrame(frame)
}

// Rebuilds (geometry + material) are coalesced to one per animation frame so dragging a
// slider doesn't dispose/rebuild the mesh on every intermediate `input` tick.
watch(config, () => {
  if (rebuildRaf) return
  rebuildRaf = requestAnimationFrame(() => { rebuildRaf = 0; engine?.setConfig(config.value) })
}, { deep: true })

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const startX = e.clientX, startY = e.clientY
  const startYaw = orbit.yaw, startPitch = orbit.pitch
  function move(ev: PointerEvent) {
    orbit.yaw = startYaw + (ev.clientX - startX) * 0.012
    orbit.pitch = Math.max(-1.3, Math.min(1.3, startPitch - (ev.clientY - startY) * 0.012))
  }
  function up() {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
function onWheel(e: WheelEvent) {
  orbit.zoom = Math.max(0.4, Math.min(3, orbit.zoom - e.deltaY * 0.0012))
}

onMounted(() => {
  if (!detectWebGL()) { webglOk.value = false; return }
  const { w, h } = previewDims()
  engine = new ShapeEngine(canvas.value!, w, h)
  lastW = w; lastH = h
  engine.setConfig(config.value)
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => {
  saveConfig()
  if (raf) cancelAnimationFrame(raf)
  if (rebuildRaf) cancelAnimationFrame(rebuildRaf)
  if (actionErrorTimer) clearTimeout(actionErrorTimer)
  engine?.dispose()
  engine = null
})

// ── outputs (mirror Gradient/Space Type's image path exactly) ──────────────────────────
async function exportPng() {
  if (!engine) return
  exporting.value = true
  actionError.value = ''
  // Stop the live rAF loop while frameToBlob temporarily resizes the renderer — otherwise
  // the loop's own engine.render(orbit) can land mid-resize (same race Gradient/Space Type
  // avoid via stopPreview()/startPreview() around their bakes).
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  try {
    const blob = await engine.frameToBlob(canvasW.value, canvasH.value)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'shape_img')
    if (filename) {
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:shapeStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) {
    console.error('[shape-studio] export failed', e)
    setActionError('Export failed — please try again')
  } finally {
    exporting.value = false
    raf = requestAnimationFrame(frame)
  }
}

// ── settings export / import ─────────────────────────────────────────────────────────────
function exportSettings() {
  const blob = new Blob([JSON.stringify(config.value)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `shape-studio-${config.value.seed.replace('#', '')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
const importInput = ref<HTMLInputElement | null>(null)
function triggerImport() { importInput.value?.click() }
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    config.value = mergeConfig(JSON.parse(text))
    actionError.value = ''
  } catch (err) {
    console.error('[shape-studio] import settings failed', err)
    setActionError('Could not read settings file')
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <StudioModalShell
    title="Shape studio"
    :agent="shapeAgent"
    agent-placeholder="Describe the shape — e.g. more faceted, warmer palette, sharper edges…"
    @close="closeEditor"
  >
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas
          ref="canvas"
          class="max-h-full max-w-full touch-none rounded-lg shadow-2xl"
          :style="{ filter: distortionFilter }"
          @pointerdown="onPointerDown"
          @wheel.prevent="onWheel"
        />
        <div
          v-if="config.style.grain > 0"
          class="pointer-events-none absolute rounded-lg"
          :style="grainStyle"
        />
        <div v-if="!webglOk" class="absolute inset-0 flex items-center justify-center text-xs text-white/50">
          3D preview unavailable on this device.
        </div>
        <!-- 0×0 SVG host for the distortion filter primitive — not rendered itself. -->
        <svg width="0" height="0" style="position: absolute">
          <defs>
            <filter :id="distortFilterId">
              <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" :scale="distortionScale" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
      </div>
    </template>
    <template #actions>
      <StudioButton variant="secondary" @click="triggerImport">Import settings</StudioButton>
      <StudioButton variant="secondary" @click="exportSettings">Export settings</StudioButton>
      <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
      <span v-if="actionError" class="text-[11px] text-red-400/90">{{ actionError }}</span>
      <span class="flex-1" />
      <button
        type="button"
        class="rounded bg-action px-3.5 py-1.5 text-[12px] font-medium text-white transition enabled:hover:bg-action/85 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!webglOk || exporting"
        @click="exportPng"
      >
        {{ exporting ? 'Exporting…' : 'Export PNG' }}
      </button>
    </template>
    <template #controls>
      <!-- Seed + Re-roll -->
      <div class="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <div class="flex flex-col">
          <span class="text-[10px] uppercase tracking-wide text-white/30">Seed</span>
          <span class="font-mono text-[11px] text-white/70">{{ config.seed }}</span>
        </div>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded bg-action px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-action/85"
          @click="rerollConfig"
        >
          <Dices class="h-3.5 w-3.5" /> Re-roll
        </button>
      </div>

      <!-- Fill mode -->
      <div class="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <span class="text-[11px] text-white/55">Fill mode</span>
        <StudioSegmented v-model="fillModeProxy" :options="['facets', 'surface']" />
      </div>

      <!-- Shape -->
      <StudioSection title="Shape">
        <template #badge>
          <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('shape')">
            <component :is="locked('shape') ? Lock : Unlock" class="h-3 w-3" />
          </button>
        </template>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Mode</label>
          <StudioSegmented v-model="shapeModeProxy" :options="['primitive', 'gem']" />
        </div>
        <template v-if="config.shape.mode === 'primitive'">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Primitive</label>
            <StudioSelect v-model="primitiveProxy" :options="PRIMITIVE_OPTIONS" />
          </div>
          <StudioSlider
            :model-value="config.shape.density" label="Density" :min="0" :max="4" :step="1" :default="DEFAULT_CONFIG.shape.density"
            :bindable="true" :bound="boundColumnFor('shape.density')"
            @update:model-value="(v: number) => { config.shape.density = v; onEdit('shape.density', v) }"
            @promote="promote({ key: 'shape.density', label: 'Density', kind: 'slider', min: 0, max: 4, step: 1 }, config.shape.density)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.density', label: 'Density', kind: 'slider', min: 0, max: 4, step: 1 })"
          />
        </template>
        <template v-else>
          <StudioSlider
            :model-value="config.shape.vertices" label="Vertices" :min="4" :max="40" :step="1" :default="DEFAULT_CONFIG.shape.vertices"
            :bindable="true" :bound="boundColumnFor('shape.vertices')"
            @update:model-value="(v: number) => { config.shape.vertices = v; onEdit('shape.vertices', v) }"
            @promote="promote({ key: 'shape.vertices', label: 'Vertices', kind: 'slider', min: 4, max: 40, step: 1 }, config.shape.vertices)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.vertices', label: 'Vertices', kind: 'slider', min: 4, max: 40, step: 1 })"
          />
          <StudioSlider
            :model-value="config.shape.depth" label="Depth" :min="0.2" :max="2" :step="0.05" :default="DEFAULT_CONFIG.shape.depth"
            :bindable="true" :bound="boundColumnFor('shape.depth')"
            @update:model-value="(v: number) => { config.shape.depth = v; onEdit('shape.depth', v) }"
            @promote="promote({ key: 'shape.depth', label: 'Depth', kind: 'slider', min: 0.2, max: 2, step: 0.05 }, config.shape.depth)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.depth', label: 'Depth', kind: 'slider', min: 0.2, max: 2, step: 0.05 })"
          />
          <StudioSlider
            :model-value="config.shape.spread" label="Spread" :min="0.1" :max="1" :step="0.05" :default="DEFAULT_CONFIG.shape.spread"
            :bindable="true" :bound="boundColumnFor('shape.spread')"
            @update:model-value="(v: number) => { config.shape.spread = v; onEdit('shape.spread', v) }"
            @promote="promote({ key: 'shape.spread', label: 'Spread', kind: 'slider', min: 0.1, max: 1, step: 0.05 }, config.shape.spread)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.spread', label: 'Spread', kind: 'slider', min: 0.1, max: 1, step: 0.05 })"
          />
        </template>
        <StudioSlider
          :model-value="config.shape.jitter" label="Jitter" :min="0" :max="100" :step="1" :default="DEFAULT_CONFIG.shape.jitter"
          :bindable="true" :bound="boundColumnFor('shape.jitter')"
          @update:model-value="(v: number) => { config.shape.jitter = v; onEdit('shape.jitter', v) }"
          @promote="promote({ key: 'shape.jitter', label: 'Jitter', kind: 'slider', min: 0, max: 100, step: 1 }, config.shape.jitter)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.jitter', label: 'Jitter', kind: 'slider', min: 0, max: 100, step: 1 })"
        />
        <StudioSlider
          :model-value="config.shape.scale" label="Scale" :min="0.25" :max="3" :step="0.05" :default="DEFAULT_CONFIG.shape.scale"
          :bindable="true" :bound="boundColumnFor('shape.scale')"
          @update:model-value="(v: number) => { config.shape.scale = v; onEdit('shape.scale', v) }"
          @promote="promote({ key: 'shape.scale', label: 'Scale', kind: 'slider', min: 0.25, max: 3, step: 0.05 }, config.shape.scale)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'shape.scale', label: 'Scale', kind: 'slider', min: 0.25, max: 3, step: 0.05 })"
        />
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Projection</label>
          <StudioSegmented v-model="projectionProxy" :options="['orthographic', 'perspective']" />
        </div>
      </StudioSection>

      <!-- Palette (facets) -->
      <StudioSection v-if="config.fillMode === 'facets'" title="Palette">
        <template #badge>
          <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('palette')">
            <component :is="locked('palette') ? Lock : Unlock" class="h-3 w-3" />
          </button>
        </template>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Base color</label>
          <StudioColor v-model="baseColorHex" />
        </div>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Harmony</label>
          <div class="grid grid-cols-2 gap-1">
            <button
              v-for="h in HARMONY_TYPES" :key="h" type="button"
              class="rounded px-2 py-1 text-left text-[11px] transition-colors"
              :class="config.palette.harmony === h ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'"
              @click="config.palette.harmony = h"
            >{{ HARMONY_LABELS[h] }}</button>
          </div>
        </div>
        <StudioSlider
          :model-value="config.palette.baseHue" label="Hue" :min="0" :max="360" :step="1" :default="DEFAULT_CONFIG.palette.baseHue"
          :bindable="true" :bound="boundColumnFor('palette.baseHue')"
          @update:model-value="(v: number) => { config.palette.baseHue = v; onEdit('palette.baseHue', v) }"
          @promote="promote({ key: 'palette.baseHue', label: 'Hue', kind: 'slider', min: 0, max: 360, step: 1 }, config.palette.baseHue)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'palette.baseHue', label: 'Hue', kind: 'slider', min: 0, max: 360, step: 1 })"
        />
        <StudioSlider
          :model-value="config.palette.saturation" label="Saturation" :min="0" :max="100" :step="1" :default="DEFAULT_CONFIG.palette.saturation"
          :bindable="true" :bound="boundColumnFor('palette.saturation')"
          @update:model-value="(v: number) => { config.palette.saturation = v; onEdit('palette.saturation', v) }"
          @promote="promote({ key: 'palette.saturation', label: 'Saturation', kind: 'slider', min: 0, max: 100, step: 1 }, config.palette.saturation)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'palette.saturation', label: 'Saturation', kind: 'slider', min: 0, max: 100, step: 1 })"
        />
        <StudioSlider
          :model-value="config.palette.lightness" label="Lightness" :min="0" :max="100" :step="1" :default="DEFAULT_CONFIG.palette.lightness"
          :bindable="true" :bound="boundColumnFor('palette.lightness')"
          @update:model-value="(v: number) => { config.palette.lightness = v; onEdit('palette.lightness', v) }"
          @promote="promote({ key: 'palette.lightness', label: 'Lightness', kind: 'slider', min: 0, max: 100, step: 1 }, config.palette.lightness)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'palette.lightness', label: 'Lightness', kind: 'slider', min: 0, max: 100, step: 1 })"
        />
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Preview</label>
          <div class="h-4 rounded" :style="{ background: paletteRampCss }" />
          <div class="mt-1 flex h-2.5 gap-0.5 overflow-hidden rounded">
            <div v-for="(c, i) in paletteSwatches" :key="i" class="flex-1" :style="{ background: c }" />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Coloring</label>
          <StudioSegmented v-model="coloringProxy" :options="['prismatic', 'smooth', 'faceted', 'ombre', 'scatter']" />
        </div>
        <div v-if="config.palette.coloring !== 'scatter'">
          <label class="mb-1 block text-[11px] text-white/55">Direction</label>
          <StudioSegmented v-model="directionProxy" :options="['vertical', 'depth', 'radial', 'angular']" />
        </div>
      </StudioSection>

      <!-- Fill (surface) -->
      <StudioSection v-else title="Fill">
        <template #badge>
          <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('palette')">
            <component :is="locked('palette') ? Lock : Unlock" class="h-3 w-3" />
          </button>
        </template>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Fill type</label>
          <StudioSelect v-model="fillTypeProxy" :options="FILL_TYPES" />
        </div>
        <div class="flex gap-4">
          <FillSwatch
            label="Color 1" :color="config.fill.a" :bound="boundColumnFor('fill.a')"
            @update:color="(v: string) => { config.fill.a = v; onEdit('fill.a', v) }"
            @promote="promote({ key: 'fill.a', label: 'Color 1', kind: 'color' }, config.fill.a)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'fill.a', label: 'Color 1', kind: 'color' })"
            @edit="goToCollection"
          />
          <FillSwatch
            v-if="fillNeedsB"
            label="Color 2" :color="config.fill.b" :bound="boundColumnFor('fill.b')"
            @update:color="(v: string) => { config.fill.b = v; onEdit('fill.b', v) }"
            @promote="promote({ key: 'fill.b', label: 'Color 2', kind: 'color' }, config.fill.b)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'fill.b', label: 'Color 2', kind: 'color' })"
            @edit="goToCollection"
          />
        </div>
        <StudioSlider
          v-if="fillHasAngle"
          :model-value="config.fill.angle" label="Angle" :min="0" :max="360" :step="1" :default="DEFAULT_CONFIG.fill.angle"
          :bindable="true" :bound="boundColumnFor('fill.angle')"
          @update:model-value="(v: number) => { config.fill.angle = v; onEdit('fill.angle', v) }"
          @promote="promote({ key: 'fill.angle', label: 'Angle', kind: 'slider', min: 0, max: 360, step: 1 }, config.fill.angle)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'fill.angle', label: 'Angle', kind: 'slider', min: 0, max: 360, step: 1 })"
        />
        <StudioSlider
          v-if="fillHasDensity"
          :model-value="config.fill.density" label="Density" :min="2" :max="32" :step="1" :default="DEFAULT_CONFIG.fill.density"
          :bindable="true" :bound="boundColumnFor('fill.density')"
          @update:model-value="(v: number) => { config.fill.density = v; onEdit('fill.density', v) }"
          @promote="promote({ key: 'fill.density', label: 'Density', kind: 'slider', min: 2, max: 32, step: 1 }, config.fill.density)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'fill.density', label: 'Density', kind: 'slider', min: 2, max: 32, step: 1 })"
        />
      </StudioSection>

      <!-- Style -->
      <StudioSection title="Style">
        <template #badge>
          <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('style')">
            <component :is="locked('style') ? Lock : Unlock" class="h-3 w-3" />
          </button>
        </template>
        <StudioSlider
          :model-value="config.style.grain" label="Grain" :min="0" :max="100" :step="1" :default="DEFAULT_CONFIG.style.grain"
          :bindable="true" :bound="boundColumnFor('style.grain')"
          @update:model-value="(v: number) => { config.style.grain = v; onEdit('style.grain', v) }"
          @promote="promote({ key: 'style.grain', label: 'Grain', kind: 'slider', min: 0, max: 100, step: 1 }, config.style.grain)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'style.grain', label: 'Grain', kind: 'slider', min: 0, max: 100, step: 1 })"
        />
        <StudioSlider
          :model-value="config.style.distortion" label="Distortion" :min="0" :max="100" :step="1" :default="DEFAULT_CONFIG.style.distortion"
          :bindable="true" :bound="boundColumnFor('style.distortion')"
          @update:model-value="(v: number) => { config.style.distortion = v; onEdit('style.distortion', v) }"
          @promote="promote({ key: 'style.distortion', label: 'Distortion', kind: 'slider', min: 0, max: 100, step: 1 }, config.style.distortion)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'style.distortion', label: 'Distortion', kind: 'slider', min: 0, max: 100, step: 1 })"
        />
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Transparent background</span>
          <StudioSwitch v-model="bgTransparent" />
        </div>
        <div v-if="!bgTransparent" class="flex items-center gap-2">
          <span class="text-[11px] text-white/55">Background</span>
          <StudioColor v-model="bgColorProxy" />
        </div>
      </StudioSection>

      <!-- Canvas (not lockable) -->
      <StudioSection title="Canvas">
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Aspect</label>
          <StudioSelect v-model="aspectKey" :options="ASPECT_OPTIONS" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Width</label>
            <input v-model.number="canvasW" type="number" min="64" max="4096" step="1"
                   class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Height</label>
            <input v-model.number="canvasH" type="number" min="64" max="4096" step="1"
                   class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20" />
          </div>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
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
