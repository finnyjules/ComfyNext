<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { Dices, Lock, Minus, Plus, Trash2, Unlock } from 'lucide-vue-next'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { LIQUID_PRESETS, buildConfig, defaultConfig, liquidConfig, liquidPresetConfig, meshConfig, reroll, rippleConfig, stackConfig, type RerollScope } from '~/lib/gradientfx/randomize'
import { MESH_MAX_POINTS, buildMeshPoints, defaultMesh } from '~/lib/gradientfx/mesh'
import { randomSeed } from '~/lib/gradientfx/rng'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { animatableTargets, dropTracksForLayer, remapTracksOnInsert, remapTracksOnReorder } from '~/lib/gradientfx/motion'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioLayerStack from '~/components/vue-canvas/StudioLayerStack.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import BindableRow from '~/components/vue-canvas/studio/BindableRow.vue'
import PalettePicker from '~/components/vue-canvas/studio/PalettePicker.vue'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { makeConfigParams } from '~/lib/agent/configParams'
import { GRADIENT_GUIDANCE, gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { typeCompatible } from '~/lib/collection/bindables'
import { addSweepRows } from '~/lib/collection/model'
import { COLLECTION_PROP, VARS_TYPE, type CollectionColumn, type CollectionData } from '~/lib/collection/types'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { effectiveColumns, makeLookupResolver } from '~/lib/collection/lookup'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import {
  ASPECTS, BLEND_MODES, DEFAULT_FOCUS, DIRECTIONS, GRADIENT_DIRS, LAYER_MAX, LAYOUTS, MAPPINGS, MIRROR_KINDS, RING_SHAPES, SHAPE_KINDS,
  aspectRatio, cloneConfig, ensureConfigDefaults, type GradientConfig, type LayoutKind, type MeshConfig, type ShapeKind,
} from '~/lib/gradientfx/types'

const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills/videos as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

// ── config (single source of truth) ─────────────────────────────────────────
const config = ref<GradientConfig>(defaultConfig('#default0'))
const activeLayer = ref(0)
const layer = computed(() => config.value.layers[activeLayer.value] ?? config.value.layers[0]!)
const animatable = computed(() => animatableTargets(config.value))
const isRadial = computed(() => config.value.canvas.layout === 'radial' || config.value.canvas.layout === 'orbit')
const isStack = computed(() => config.value.canvas.layout === 'stack')
const isLiquid = computed(() => config.value.canvas.layout === 'liquid')
const isMesh = computed(() => config.value.canvas.layout === 'mesh')
// Focus (soft-focus/DoF) is an optional, additive config. Guarantee it exists on
// the current config so the Focus section's v-models are always non-null — presets
// replace the whole config and defaultConfig() omits it. Runs before render.
watch(config, (c) => { if (c && !c.focus) c.focus = { ...DEFAULT_FOCUS } }, { immediate: true, flush: 'sync' })

// In-product agent — "tune" the gradient in natural language (Phase 1). The
// studio's nested `config` is bridged to a flat Params via makeConfigParams; only
// the controls that apply to the current layout are offered to the model.
const { getLocalSetting } = useLocalSettings()
const agentParams = makeConfigParams(() => config.value, () => activeLayer.value)
const activeAgentControls = computed(() => gradientAgentControls(config.value))
// The shell renders the prompt + results from this object (see StudioModalShell).
const gradientAgent = useStudioAgent({
  controls: () => activeAgentControls.value, params: agentParams, label: () => 'Gradient studio',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  guidance: () => GRADIENT_GUIDANCE,
  render: () => renderGradientForReview(),
})

// Collections variable binding (Slice 2a, Task 6) — Gradient is the first inline-
// markup surface to get promote/bind chips. Controls are hardcoded `v-model`s into
// the nested `config` ref rather than a data-driven loop, so — unlike Space Type —
// there's no single ControlSpec[] driving the template; `studioControls` mirrors
// what the agent tuner already offers (via `controlsForStudio`, loaded once since
// the composable wants a synchronous accessor) purely for the bind-menu's control
// descriptions (label/kind/min/max/step/options), matched by dotted key.
const studioControls = ref<StudioControlDesc[]>([])
onMounted(async () => { studioControls.value = await controlsForStudio(currentNode()) })

// The SAME dotted-path proxy the canvas agent tuner reads/writes (`canvas.margin`,
// `flow.intensity`, `layer.color.stops.0.color`…) — reused here so onEdit/promote/
// unbind's "live value" reads and applyParam's writes address identical keys. Writing
// through this proxy mutates `config` directly, so the surface's existing `deep`
// watcher on `config` (see `watch(config, ...)` above) re-renders the preview — no
// extra watcher needed, and per the loop-safety note, nothing here calls onEdit from
// a config watch (only the explicit control handlers below do).
const paramsProxy = makeConfigParams(() => config.value, () => activeLayer.value)
const { boundColumnFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes, edges: () => props.edges ?? [] },
)

// Wired collection lookup (studio -> collection) for the "Bind to" submenu.
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
// collection and hands off to the drawer + a follow-up run event (see
// runSweepRows dispatch below and VueNodeCanvas's pending-sweep stash).
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

// Render the current gradient to a PNG for the agent's visual self-review.
function renderGradientForReview(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const ar = aspectRatio(config.value.canvas.aspect)
    const W = ar >= 1 ? 1024 : Math.round(1024 * ar)
    const H = ar >= 1 ? Math.round(1024 / ar) : 1024
    const off = document.createElement('canvas'); off.width = W; off.height = H
    const ctx = off.getContext('2d'); if (!ctx) return null
    ctx.drawImage(gradientFx.render(config.value, W, H, 0), 0, 0)
    return off.toDataURL('image/png')
  } catch { return null }
}

// Flow speed/gloss are optional on the schema; proxy them so v-model stays simple.
const flowSpeed = computed({
  get: () => config.value.flow?.speed ?? 0,
  set: (v: number) => { if (config.value.flow) config.value.flow.speed = v },
})
const flowGloss = computed({
  get: () => config.value.flow?.gloss ?? 0,
  set: (v: number) => { if (config.value.flow) config.value.flow.gloss = v },
})
// Liquid-surface params (all optional on the schema) → simple v-model proxies.
function flowProxy(key: 'veins' | 'veinScale' | 'ripple' | 'refract' | 'viscosity' | 'swirl', dflt = 0) {
  return computed({
    get: () => config.value.flow?.[key] ?? dflt,
    set: (v: number) => { if (config.value.flow) config.value.flow[key] = v },
  })
}
const flowVeins = flowProxy('veins')
const flowVeinScale = flowProxy('veinScale', 35)
const flowRipple = flowProxy('ripple')
const flowRefract = flowProxy('refract')
const flowViscosity = flowProxy('viscosity')
const flowSwirl = flowProxy('swirl')

// Layer-0 mesh block, guaranteed to exist (created on demand). The mesh layout only
// ever reads layer 0, so all mesh editing targets it.
function ensureMesh(): MeshConfig {
  const L0 = config.value.layers[0]!
  if (!L0.mesh) L0.mesh = defaultMesh(L0.color.stops, config.value.seed)
  return L0.mesh
}
const mesh = computed(() => (isMesh.value ? ensureMesh() : (config.value.layers[0]?.mesh ?? defaultMesh([], '#x'))))
// blur is optional on the schema; proxy it so v-model + reset stay simple.
const meshBlur = computed({
  get: () => mesh.value.blur ?? 0,
  set: (v: number) => { ensureMesh().blur = v },
})

function addMeshPoint() {
  const m = ensureMesh()
  if (m.points.length >= MESH_MAX_POINTS) return
  m.points.push({ x: 0.5, y: 0.5, color: '#ffffff' })
}
function removeMeshPoint(i: number) {
  const m = ensureMesh()
  if (m.points.length > 2) m.points.splice(i, 1)
}
function scatterMesh() {
  const m = ensureMesh()
  m.points = buildMeshPoints(m.points.length, config.value.layers[0]!.color.stops, randomSeed())
}

// Proxies for the optional center/light fields so v-model stays simple and type-safe
// (the fields are backfilled by ensureConfigDefaults, but typed optional).
const centerX = computed({
  get: () => config.value.canvas.center?.x ?? 0,
  set: (v: number) => { (config.value.canvas.center ??= { x: 0, y: 0 }).x = v },
})
const centerY = computed({
  get: () => config.value.canvas.center?.y ?? 0,
  set: (v: number) => { (config.value.canvas.center ??= { x: 0, y: 0 }).y = v },
})
const lightAz = computed({
  get: () => config.value.relief.light?.azimuth ?? 135,
  set: (v: number) => { (config.value.relief.light ??= { azimuth: 135, elevation: 45 }).azimuth = v },
})
const lightEl = computed({
  get: () => config.value.relief.light?.elevation ?? 45,
  set: (v: number) => { (config.value.relief.light ??= { azimuth: 135, elevation: 45 }).elevation = v },
})

// ── rolls history (session-scoped) ──────────────────────────────────────────
interface Roll { seed: string; thumb: string; cfg: GradientConfig }
const rolls = reactive<Roll[]>([])
const ROLL_CAP = 48

// ── preview ─────────────────────────────────────────────────────────────────
const canvas = ref<HTMLCanvasElement | null>(null)
const baking = ref(false)
const bakeMsg = ref('')
const glError = ref<string | null>(null)
let raf = 0
let start = 0
const PREVIEW_MAX_W = 880

// Size the preview to its on-screen box, then render the backing store at the display's
// physical pixel density (dpr). Rendering at a fixed 880px and letting the browser scale
// it (esp. 2× on Retina) resampled the fine film grain into a faint moiré; backing =
// CSS-size × dpr means 1 render pixel maps to 1 physical pixel — crisp grain, no moiré.
function previewDims() {
  const el = canvas.value
  const ar = aspectRatio(config.value.canvas.aspect)
  const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2)
  const wrap = el?.parentElement
  const availW = wrap?.clientWidth || PREVIEW_MAX_W
  const availH = wrap?.clientHeight || Math.round(PREVIEW_MAX_W / ar)
  let cssW = Math.min(availW, PREVIEW_MAX_W)
  let cssH = cssW / ar
  if (cssH > availH) { cssH = availH; cssW = availH * ar }
  cssW = Math.round(cssW); cssH = Math.round(cssH)
  return { cssW, cssH, w: Math.max(1, Math.round(cssW * dpr)), h: Math.max(1, Math.round(cssH * dpr)) }
}

// Screen box of the canvas (relative to the preview container), so the mesh drag
// handles overlay exactly on top of it.
// Preview zoom (visual scale of the canvas) + pan offset. 1 = 100%, 25%..400%.
// When zoomed in, scrolling over the preview pans (translate) the scaled canvas;
// pan is clamped so the canvas can't be scrolled entirely out of view.
const zoom = ref(1)
const pan = reactive({ x: 0, y: 0 })
function clampPan() {
  const el = canvas.value
  if (!el) { pan.x = 0; pan.y = 0; return }
  const maxX = Math.max(0, (el.clientWidth * (zoom.value - 1)) / 2)
  const maxY = Math.max(0, (el.clientHeight * (zoom.value - 1)) / 2)
  pan.x = Math.min(maxX, Math.max(-maxX, pan.x))
  pan.y = Math.min(maxY, Math.max(-maxY, pan.y))
}
function zoomBy(f: number) {
  zoom.value = Math.min(4, Math.max(0.25, Math.round(zoom.value * f * 100) / 100))
  clampPan()
}
function resetZoom() { zoom.value = 1; pan.x = 0; pan.y = 0 }
function onPreviewWheel(e: WheelEvent) {
  if (zoom.value <= 1) return           // 100% or below: leave normal scroll alone
  e.preventDefault()
  pan.x -= e.deltaX
  pan.y -= e.deltaY
  clampPan()
}

const meshOverlay = ref({ left: 0, top: 0, w: 0, h: 0 })
function syncOverlay() {
  const el = canvas.value
  if (!el) return
  // The canvas is CSS-scaled about its centre then panned; move+scale the mesh
  // overlay the same way (offsetLeft/clientWidth are layout values that ignore the
  // transform) so the drag handles stay aligned with the zoomed/panned canvas.
  const z = zoom.value
  const w = el.clientWidth * z, h = el.clientHeight * z
  const cx = el.offsetLeft + el.clientWidth / 2, cy = el.offsetTop + el.clientHeight / 2
  meshOverlay.value = { left: cx - w / 2 + pan.x, top: cy - h / 2 + pan.y, w, h }
}
watch([zoom, pan], syncOverlay, { deep: true })

function renderFrame(t: number) {
  const el = canvas.value
  if (!el) return
  const { cssW, cssH, w, h } = previewDims()
  el.style.width = `${cssW}px`
  el.style.height = `${cssH}px`
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try { el.getContext('2d')!.drawImage(gradientFx.render(config.value, w, h, t), 0, 0); glError.value = null }
  catch (e: any) { glError.value = String(e?.message ?? e) }
  syncOverlay()
}

// ── mesh point dragging (handles overlaid on the preview) ──────────────────────
const dragPoint = ref<number | null>(null)
function onHandleDown(i: number, e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  dragPoint.value = i
  window.addEventListener('pointermove', onHandleMove)
  window.addEventListener('pointerup', onHandleUp)
}
function onHandleMove(e: PointerEvent) {
  const i = dragPoint.value
  const el = canvas.value
  if (i == null || !el) return
  const r = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
  const y = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))
  const pt = config.value.layers[0]?.mesh?.points[i]
  if (pt) { pt.x = x; pt.y = y }
}
function onHandleUp() {
  dragPoint.value = null
  window.removeEventListener('pointermove', onHandleMove)
  window.removeEventListener('pointerup', onHandleUp)
}

// Animate when there are motion tracks OR a living drift is active (mesh point drift,
// or a flow speed that has a warp to move).
const animated = computed(() => {
  if ((config.value.motion?.tracks?.length ?? 0) > 0) return true
  const fl = config.value.flow
  const flowAnim = (fl?.speed ?? 0) > 0 && (fl?.intensity ?? 0) > 0
  const meshAnim = isMesh.value && (config.value.layers[0]?.mesh?.drift ?? 0) > 0
  return flowAnim || meshAnim
})
function loop(ts: number) {
  if (!start) start = ts
  const dur = Math.max(0.1, config.value.motion?.duration ?? 4)
  renderFrame(((ts - start) / 1000) % dur)
  raf = requestAnimationFrame(loop)
}
function startPreview() {
  cancelAnimationFrame(raf); start = 0
  if (animated.value) raf = requestAnimationFrame(loop)
  else renderFrame(0)
}
function stopPreview() { cancelAnimationFrame(raf); raf = 0 }

watch(config, () => { if (!animated.value) renderFrame(0) }, { deep: true })
watch(animated, startPreview)

// ── randomize + rolls ────────────────────────────────────────────────────────
function makeThumb(cfg: GradientConfig): string {
  try { return gradientFx.render(cfg, 132, Math.round(132 / aspectRatio(cfg.canvas.aspect)), 0).toDataURL('image/jpeg', 0.7) }
  catch { return '' }
}
function pushRoll(cfg: GradientConfig) {
  rolls.unshift({ seed: cfg.seed, thumb: makeThumb(cfg), cfg: cloneConfig(cfg) })
  if (rolls.length > ROLL_CAP) rolls.length = ROLL_CAP
}
function randomize(scope: RerollScope) {
  config.value = reroll(config.value, scope, randomSeed())
  pushRoll(config.value)
}

// Preset: the 3D-embossed rainbow orbit (the reference look).
function applyRipple() {
  config.value = rippleConfig(randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// Preset: stacked rotated-gradient circles (the reference's real construction).
function applyStack() {
  config.value = stackConfig(randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// Preset: warm marble liquid flow.
function applyLiquid() {
  config.value = liquidConfig(randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// Preset: soft Stripe-style point mesh.
function applyMesh() {
  config.value = meshConfig(randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// Preset: one of the named liquid looks (marble/oil/ink/lava/satin).
function applyLiquidPreset(name: (typeof LIQUID_PRESETS)[number]) {
  config.value = liquidPresetConfig(name, randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// ── locks ─────────────────────────────────────────────────────────────────
function toggleLock(key: string) {
  const locks = (config.value.locks ||= {})
  locks[key] = !locks[key]
}
const locked = (key: string) => !!config.value.locks?.[key]

// ── layers ──────────────────────────────────────────────────────────────────
function addLayer() {
  if (config.value.layers.length >= LAYER_MAX) return
  const extra = buildConfig(randomSeed()).layers[0]!
  // Normal blend at partial opacity so the new layer is immediately visible over
  // layer 1 (a random dark palette under 'lighten' looked invisible — its controls
  // then appeared to do nothing). The user can switch to lighten/screen/etc.
  extra.blend = 'normal'; extra.opacity = 0.65
  config.value.layers.push(extra)
  activeLayer.value = config.value.layers.length - 1
}
function removeLayer(i: number) {
  if (config.value.layers.length <= 1) return
  config.value.layers.splice(i, 1)
  config.value.motion.tracks = dropTracksForLayer(config.value.motion.tracks, i)
  activeLayer.value = Math.min(activeLayer.value, config.value.layers.length - 1)
}
function duplicateLayer(i: number) {
  if (config.value.layers.length >= LAYER_MAX) return
  const clone = structuredClone(toRaw(config.value.layers[i]!))
  config.value.layers.splice(i + 1, 0, clone)
  config.value.motion.tracks = remapTracksOnInsert(config.value.motion.tracks, i + 1)
  activeLayer.value = i + 1
}
function reorderLayer(from: number, to: number) {
  const [moved] = config.value.layers.splice(from, 1)
  config.value.layers.splice(to, 0, moved!)
  config.value.motion.tracks = remapTracksOnReorder(config.value.motion.tracks, from, to)
  activeLayer.value = to
}

// Layer visibility is a real persisted `LayerConfig.enabled` field (absent/true =
// shown, false = hidden). Reading/writing it directly keeps the eye icon reactive
// and durable across save/reload, and the renderer skips a disabled layer — so
// hiding the base layer promotes the next enabled one, matching the shader studio.
function layerEnabled(i: number) {
  return config.value.layers[i]?.enabled !== false
}
function toggleLayer(i: number) {
  const L = config.value.layers[i]
  if (L) L.enabled = L.enabled === false
}

// ── color stops ─────────────────────────────────────────────────────────────
function addStop() {
  const stops = layer.value.color.stops
  stops.push({ color: '#ffffff', pos: stops.length ? 1 : 0 })
}
function removeStop(i: number) {
  const stops = layer.value.color.stops
  if (stops.length > 2) stops.splice(i, 1)
}
/** Replace the active layer's stops from a colour-theory harmony. */
function applyPaletteStops(stops: { pos: number; color: string }[]) {
  layer.value.color.stops = stops.map(s => ({ color: s.color, pos: s.pos }))
  stops.forEach((s, i) => onEdit(`layer.color.stops.${i}.color`, s.color))
}

// ── motion tracks ─────────────────────────────────────────────────────────────
function addTrack() {
  const a = animatable.value.find(t => /\.shape\.phase$/.test(t.path)) ?? animatable.value[0]
  if (!a) return
  config.value.motion.tracks.push({
    path: a.path, from: a.min, to: a.max,
    // pingpong loops seamlessly (frame 0 == frame N) — this section exports
    // looping video, so a linear default would hard-cut at the loop boundary.
    easing: 'pingpong', loops: 1, hold: 0, cycleOffset: 0, delay: 0,
  })
  onEdit('motion.tracks', config.value.motion.tracks.length)
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── export ────────────────────────────────────────────────────────────────────
const EXPORT_RES = [{ label: '2K', w: 2048 }, { label: '4K', w: 4096 }, { label: '8K', w: 8192 }]
const exportFormat = ref<'png' | 'jpg'>('png')
const exportResW = ref(2048)
const exportDims = computed(() => {
  const ar = aspectRatio(config.value.canvas.aspect)
  return { w: exportResW.value, h: Math.round(exportResW.value / ar) }
})
function downloadExport() {
  const { w, h } = exportDims.value
  const out = gradientFx.render(config.value, w, h, 0)
  const a = document.createElement('a')
  a.href = out.toDataURL(exportFormat.value === 'png' ? 'image/png' : 'image/jpeg', 0.95)
  a.download = `gradient-${config.value.seed.replace('#', '')}.${exportFormat.value}`
  a.click()
}

// ── config persistence ────────────────────────────────────────────────────────
function loadConfig() {
  const c = currentNode()?.data?.properties?.sailor_gradientStudio
  if (c && typeof c === 'object') config.value = ensureConfigDefaults(cloneConfig(c))
}
function saveConfig() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.sailor_gradientStudio = cloneConfig(config.value)
}

// Copy the current config JSON to the clipboard — for teaching the agent: build
// the look you want, click Copy, paste it back with the prompt it should satisfy.
const copied = ref(false)
async function copyConfig() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(config.value))
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch (e) { console.error('[gradient] copy config failed', e) }
}
// Save must never block closing — swallow any persistence error so the user can
// always exit the modal.
function closeEditor() {
  try { saveConfig() } catch (e) { console.error('[gradient] saveConfig failed', e) }
  emit('close')
}

// ── outputs (mirror Space Type) ───────────────────────────────────────────────
async function generateImage() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  stopPreview()
  try {
    const blob = await renderCurrentBlob()
    if (!blob) return
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'gradient_img')
    if (filename) {
      const n = currentNode()
      if (n) { n.data ||= {}; n.data.properties ||= {}; saveConfig() }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:gradientStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) { console.error('[gradient] image generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

// Shared full-res blob capture — same render call `generateImage` uses, factored
// out so the param baker below (and any future caller) stays byte-identical.
async function renderCurrentBlob(): Promise<Blob | null> {
  const { w, h } = exportDims.value
  return await gradientFx.renderToBlob(config.value, Math.min(w, 4096), Math.min(h, 4096), 0)
}

// Studio param-baker (Slice 2a Task 8b) — bakes ONE frame with a set of
// `params.*` overrides applied (a collection sweep/generate row), without
// disturbing the studio's live on-screen config: snapshot the current value
// of every overridden key via the same dotted-path proxy the agent/onEdit
// paths use (`paramsProxy`), write the overrides through that same proxy
// (mutating the reactive `config` — identical to a user edit), render one
// full-res frame, then restore the snapshots in `finally` regardless of
// success/failure. `gradientFx.renderToBlob` draws straight to its own
// internal canvas (not the on-screen preview `<canvas>` ref) and is fully
// synchronous up to the `toBlob` callback, so there's no Vue render tick to
// wait out here — writing `config` then calling `renderToBlob` immediately
// sees the new values with no `nextTick`/rAF needed.
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  const keys = Object.keys(overrides)
  // Pin the active layer at entry: `paramsProxy`'s `layer.`-scoped keys resolve
  // against activeLayer.value LIVE, so if the user switches layers while this
  // awaits renderCurrentBlob(), the module-level proxy would snapshot/restore
  // against a DIFFERENT layer than the one the overrides were meant for. Build
  // a local proxy pinned to the layer active at call time and use it for the
  // snapshot, the override application, and the restore.
  const pinned = activeLayer.value
  const pinnedParams = makeConfigParams(() => config.value, () => pinned)
  const snapshot = new Map<string, string | number | undefined>()
  for (const key of keys) snapshot.set(key, pinnedParams[key] as string | number | undefined)
  try {
    for (const key of keys) pinnedParams[key] = overrides[key]!
    return await renderCurrentBlob()
  } catch (e) {
    console.error('[gradient] param-baker render failed', e)
    return null
  } finally {
    for (const key of keys) {
      const prev = snapshot.get(key)
      if (prev !== undefined) pinnedParams[key] = prev
    }
  }
}

async function generateVideo() {
  baking.value = true
  stopPreview()
  try {
    const m = config.value.motion
    const { w, h } = { w: m.size && aspectRatio(config.value.canvas.aspect) >= 1 ? Math.round(m.size * aspectRatio(config.value.canvas.aspect)) : m.size, h: m.size }
    const total = Math.max(1, Math.round(m.fps * m.duration))
    const bakeCfg = { fps: m.fps, loopDuration: m.duration, W: w, H: h, seed: config.value.seed, sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      renderFrame: async (i) => {
        bakeMsg.value = `Baking ${i + 1}/${total}`
        return gradientFx.renderToBlob(config.value, w, h, (i / m.fps))
      },
    })
    bakeMsg.value = 'Encoding…'
    const res = await fetch('/sailor/spacetype_encode', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: bake.frames, fps: m.fps, width: w, height: h }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('sailor:gradientStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } },
      }))
      closeEditor()
    } else { bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'; console.error('[gradient] encode failed', data) }
  } catch (e) { console.error('[gradient] video generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

// ── keyboard shortcuts ────────────────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') { e.preventDefault(); randomize('all') }
  else if (e.key === 'c' || e.key === 'C') randomize('colors')
  else if (e.key === 's' || e.key === 'S') randomize('structure')
  else if (e.key === 'e' || e.key === 'E') downloadExport()
  else if (e.key === 'Escape') closeEditor()
}

// Re-render the static preview when its container resizes, so the dpr-matched backing
// stays 1:1 with the display (otherwise a resize would scale the old backing → moiré).
let resizeObs: ResizeObserver | null = null
function watchPreviewResize() {
  const wrap = canvas.value?.parentElement
  if (!wrap || typeof ResizeObserver === 'undefined') return
  resizeObs = new ResizeObserver(() => { if (!animated.value) renderFrame(0) })
  resizeObs.observe(wrap)
}

onMounted(() => {
  loadConfig()
  startPreview()
  watchPreviewResize()
  window.addEventListener('keydown', onKey)
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
})
onBeforeUnmount(() => {
  saveConfig(); stopPreview()
  resizeObs?.disconnect(); resizeObs = null
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onHandleMove)
  window.removeEventListener('pointerup', onHandleUp)
  unregisterStudioParamBaker(props.nodeId)
})

function setLayout(l: LayoutKind) {
  config.value.canvas.layout = l
  // Backfill stack params so the sliders + render agree the moment you switch to Stack.
  if (l === 'stack') {
    const s = layer.value.shape
    if (s.rotStep == null) s.rotStep = 8
    if (s.pivot == null) s.pivot = 0.1
    if (s.ringScale == null) s.ringScale = 1
    if (s.ringShape == null) s.ringShape = 'circle'
  }
  // Mesh reads layer-0 points; create them (from the current palette) on first switch.
  if (l === 'mesh') { activeLayer.value = 0; ensureMesh() }
}
function setShape(s: ShapeKind) { layer.value.shape.type = s }
</script>

<template>
  <StudioModalShell
    title="Gradient studio"
    :agent="gradientAgent"
    agent-placeholder="Describe the look — e.g. warmer, more liquid, calmer…"
    @close="closeEditor"
  >
    <template #aside>
      <StudioLayerStack
        :layers="config.layers.map((l, i) => ({ label: `Layer ${i + 1}`, enabled: layerEnabled(i) }))"
        :active-index="activeLayer" :max="LAYER_MAX"
        @select="activeLayer = $event"
        @add="addLayer" @remove="removeLayer" @duplicate="duplicateLayer"
        @reorder="reorderLayer" @toggle="toggleLayer" />
    </template>

    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center overflow-hidden" @wheel="onPreviewWheel">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl"
                :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }" />
        <!-- Mesh drag handles: one per color point, overlaid exactly on the canvas.
             z-30 lifts the handles above the floating randomize toolbar so points near
             the top stay grabbable; the container is pointer-events-none so the toolbar
             buttons still receive clicks everywhere a handle isn't. -->
        <div v-if="isMesh" class="pointer-events-none absolute z-30"
             :style="{ left: meshOverlay.left + 'px', top: meshOverlay.top + 'px', width: meshOverlay.w + 'px', height: meshOverlay.h + 'px' }">
          <button v-for="(pt, i) in (config.layers[0]?.mesh?.points ?? [])" :key="i"
                  class="pointer-events-auto absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow-md ring-1 ring-black/40 transition active:cursor-grabbing"
                  :class="dragPoint === i ? 'scale-125' : 'hover:scale-110'"
                  :style="{ left: pt.x * 100 + '%', top: pt.y * 100 + '%', background: pt.color }"
                  :title="`Point ${i + 1} — drag to move`"
                  @pointerdown="onHandleDown(i, $event)" /></div>
        <!-- Zoom controls (default z: the pointer-events-none mesh-handle overlay
             above lets clicks fall through here, and handles stay grabbable). -->
        <div class="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-white/10 bg-neutral-900/80 p-0.5 shadow-lg backdrop-blur">
          <button class="rounded p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title="Zoom out" :disabled="zoom <= 0.25" @click="zoomBy(1 / 1.25)">
            <Minus class="h-3.5 w-3.5" />
          </button>
          <button class="min-w-[3.25rem] rounded px-1 py-1 text-center text-xs tabular-nums text-white/70 transition hover:bg-white/10 hover:text-white" title="Reset to 100%" @click="resetZoom">
            {{ Math.round(zoom * 100) }}%
          </button>
          <button class="rounded p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title="Zoom in" :disabled="zoom >= 4" @click="zoomBy(1.25)">
            <Plus class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="primary" :disabled="baking" @click="generateImage">
        {{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}
      </StudioButton>
      <StudioButton variant="secondary" :disabled="baking" @click="generateVideo">
        {{ baking ? (bakeMsg || 'Working…') : 'Generate as video' }}
      </StudioButton>
      <button class="ml-1 rounded px-2 py-1 text-xs text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition"
              title="Copy this gradient's config JSON (for teaching the agent)" @click="copyConfig">
        {{ copied ? '✓ Copied' : 'Copy config' }}
      </button>
      <span v-if="glError" class="ml-2 truncate text-xs text-red-300/80">{{ glError }}</span>
    </template>

    <template #controls>
      <!-- Canvas -->
      <StudioSection title="Canvas" badge="both layers">
        <BindableRow control-key="canvas.aspect" label="Aspect ratio" kind="select" :bound="boundColumnFor('canvas.aspect')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex items-center justify-between text-xs text-white/60">
            <span>Aspect ratio</span>
            <button class="text-white/30 hover:text-white/70" @click="toggleLock('aspect')"><component :is="locked('aspect') ? Lock : Unlock" class="h-3 w-3" /></button>
          </label>
          <select v-model="config.canvas.aspect" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onEdit('canvas.aspect', config.canvas.aspect)">
            <option v-for="a in ASPECTS" :key="a" :value="a">{{ a }}</option>
          </select>
        </BindableRow>
        <label class="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>Layout</span>
          <button class="text-white/30 hover:text-white/70" @click="toggleLock('layout')"><component :is="locked('layout') ? Lock : Unlock" class="h-3 w-3" /></button>
        </label>
        <div class="mb-2 grid grid-cols-3 gap-1">
          <button v-for="l in LAYOUTS" :key="l" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="config.canvas.layout === l ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setLayout(l)">{{ l }}</button>
        </div>
        <!-- Margin insets the band/ring layouts; the liquid & mesh fields fill the frame, so hide it there. -->
        <template v-if="!isLiquid && !isMesh">
          <BindableRow control-key="canvas.margin" label="Margin" kind="slider" :min="0" :max="0.45" :step="0.01" :bound="boundColumnFor('canvas.margin')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Margin</span><span class="text-white/40">{{ config.canvas.margin.toFixed(2) }}</span></label>
            <input v-model.number="config.canvas.margin" type="range" min="0" max="0.45" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('canvas.margin', config.canvas.margin)" />
          </BindableRow>
        </template>
        <template v-if="isRadial">
          <BindableRow control-key="canvas.innerRadius" label="Inner radius" kind="slider" :min="0" :max="0.9" :step="0.01" :bound="boundColumnFor('canvas.innerRadius')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Inner radius</span><span class="text-white/40">{{ config.canvas.innerRadius.toFixed(2) }}</span></label>
            <input v-model.number="config.canvas.innerRadius" type="range" min="0" max="0.9" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('canvas.innerRadius', config.canvas.innerRadius)" />
          </BindableRow>
          <BindableRow control-key="canvas.center.x" label="Center X" kind="slider" :min="-0.5" :max="0.5" :step="0.01" :bound="boundColumnFor('canvas.center.x')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Center X</span><span class="text-white/40">{{ centerX.toFixed(2) }}</span></label>
            <input v-model.number="centerX" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('canvas.center.x', centerX)" />
          </BindableRow>
          <BindableRow control-key="canvas.center.y" label="Center Y" kind="slider" :min="-0.5" :max="0.5" :step="0.01" :bound="boundColumnFor('canvas.center.y')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Center Y</span><span class="text-white/40">{{ centerY.toFixed(2) }}</span></label>
            <input v-model.number="centerY" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('canvas.center.y', centerY)" />
          </BindableRow>
        </template>
        <label class="mb-1 block text-xs text-white/60">Background</label>
        <BindableRow control-key="canvas.background" label="Background" kind="color" :bound="boundColumnFor('canvas.background')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <StudioColor v-model="config.canvas.background" @update:model-value="(v: string) => onEdit('canvas.background', v)" />
        </BindableRow>
      </StudioSection>

      <!-- Flow (domain warp — distorts every layout; the heart of the liquid look) -->
      <StudioSection title="Flow" badge="all layouts" :open="isLiquid || isMesh">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Warps the gradient into liquid swirls. At 0 intensity the gradient is undistorted.</p>
        <BindableRow control-key="flow.angle" label="Flow angle" kind="slider" :min="0" :max="360" :step="1" :bound="boundColumnFor('flow.angle')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Angle</span><span class="text-white/40">{{ Math.round(config.flow!.angle) }}°</span></label>
          <input v-model.number="config.flow!.angle" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.angle', config.flow!.angle)" />
        </BindableRow>
        <BindableRow control-key="flow.noiseScale" label="Noise scale" kind="slider" :min="0.5" :max="8" :step="0.1" :bound="boundColumnFor('flow.noiseScale')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Noise scale</span><span class="text-white/40">{{ config.flow!.noiseScale.toFixed(1) }}</span></label>
          <input v-model.number="config.flow!.noiseScale" type="range" min="0.5" max="8" step="0.1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.noiseScale', config.flow!.noiseScale)" />
        </BindableRow>
        <BindableRow control-key="flow.intensity" label="Noise intensity" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.intensity')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Noise intensity</span><span class="text-white/40">{{ Math.round(config.flow!.intensity) }}</span></label>
          <input v-model.number="config.flow!.intensity" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.intensity', config.flow!.intensity)" />
        </BindableRow>
        <BindableRow control-key="flow.distortion" label="Curve distortion" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.distortion')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Curve distortion</span><span class="text-white/40">{{ Math.round(config.flow!.distortion) }}</span></label>
          <input v-model.number="config.flow!.distortion" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.distortion', config.flow!.distortion)" />
        </BindableRow>
        <BindableRow control-key="flow.detail" label="Detail" kind="slider" :min="1" :max="6" :step="1" :bound="boundColumnFor('flow.detail')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Detail</span><span class="text-white/40">{{ Math.round(config.flow!.detail) }}</span></label>
          <input v-model.number="config.flow!.detail" type="range" min="1" max="6" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.detail', config.flow!.detail)" />
        </BindableRow>
        <BindableRow control-key="flow.swirl" label="Swirl" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.swirl')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Swirl</span><span class="text-white/40">{{ Math.round(flowSwirl) || 'off' }}</span></label>
          <input v-model.number="flowSwirl" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.swirl', flowSwirl)" />
        </BindableRow>
        <BindableRow control-key="flow.speed" label="Flow speed" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.speed')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Flow speed</span><span class="text-white/40">{{ Math.round(flowSpeed) || 'off' }}</span></label>
          <input v-model.number="flowSpeed" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('flow.speed', flowSpeed)" />
        </BindableRow>
        <p class="mt-1 text-[10px] leading-snug text-white/30">Living drift — the warp flows over the loop. Export as video to capture the motion.</p>
      </StudioSection>

      <!-- Depth & Light (liquid fold shading only) -->
      <StudioSection v-if="isLiquid" title="Depth & light" badge="liquid">
        <label class="mb-1 block text-xs text-white/60">Presets</label>
        <div class="mb-3 grid grid-cols-3 gap-1">
          <button v-for="p in LIQUID_PRESETS" :key="p" class="rounded bg-white/[0.04] px-1 py-1 text-[11px] capitalize text-white/60 transition hover:bg-white/10 hover:text-white"
                  @click="applyLiquidPreset(p)">{{ p }}</button>
        </div>
        <BindableRow control-key="flow.depth" label="Depth" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.depth')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Depth</span><span class="text-white/40">{{ Math.round(config.flow!.depth) }}</span></label>
          <input v-model.number="config.flow!.depth" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.depth', config.flow!.depth)" />
        </BindableRow>
        <BindableRow control-key="flow.highlights" label="Highlights" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.highlights')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Highlights</span><span class="text-white/40">{{ Math.round(config.flow!.highlights) }}</span></label>
          <input v-model.number="config.flow!.highlights" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.highlights', config.flow!.highlights)" />
        </BindableRow>
        <BindableRow control-key="flow.shadows" label="Shadows" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.shadows')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Shadows</span><span class="text-white/40">{{ Math.round(config.flow!.shadows) }}</span></label>
          <input v-model.number="config.flow!.shadows" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.shadows', config.flow!.shadows)" />
        </BindableRow>
        <BindableRow control-key="flow.foldScale" label="Fold scale" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.foldScale')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Fold scale</span><span class="text-white/40">{{ Math.round(config.flow!.foldScale) }}</span></label>
          <input v-model.number="config.flow!.foldScale" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.foldScale', config.flow!.foldScale)" />
        </BindableRow>
        <BindableRow control-key="flow.gloss" label="Gloss" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.gloss')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Gloss</span><span class="text-white/40">{{ Math.round(flowGloss) || 'matte' }}</span></label>
          <input v-model.number="flowGloss" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('flow.gloss', flowGloss)" />
        </BindableRow>
      </StudioSection>

      <!-- Liquid surface (turns the smoky warp into flowing fluid) -->
      <StudioSection v-if="isLiquid" title="Liquid surface" badge="liquid" :open="true">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Push the smoky warp toward real fluid — marbled veins, a wet rippling skin, glassy refraction, and viscosity.</p>
        <BindableRow control-key="flow.veins" label="Veins" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.veins')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Veins</span><span class="text-white/40">{{ Math.round(flowVeins) || 'smooth' }}</span></label>
          <input v-model.number="flowVeins" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.veins', flowVeins)" />
        </BindableRow>
        <BindableRow control-key="flow.veinScale" label="Vein scale" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.veinScale')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Vein scale</span><span class="text-white/40">{{ Math.round(flowVeinScale) }}</span></label>
          <input v-model.number="flowVeinScale" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.veinScale', flowVeinScale)" />
        </BindableRow>
        <BindableRow control-key="flow.ripple" label="Ripple" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.ripple')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Ripple</span><span class="text-white/40">{{ Math.round(flowRipple) || 'off' }}</span></label>
          <input v-model.number="flowRipple" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.ripple', flowRipple)" />
        </BindableRow>
        <BindableRow control-key="flow.refract" label="Refraction" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.refract')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Refraction</span><span class="text-white/40">{{ Math.round(flowRefract) || 'off' }}</span></label>
          <input v-model.number="flowRefract" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('flow.refract', flowRefract)" />
        </BindableRow>
        <BindableRow control-key="flow.viscosity" label="Viscosity" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('flow.viscosity')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Viscosity</span><span class="text-white/40">{{ Math.round(flowViscosity) || 'thin' }}</span></label>
          <input v-model.number="flowViscosity" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('flow.viscosity', flowViscosity)" />
        </BindableRow>
      </StudioSection>

      <!-- Mesh (soft point-mesh gradient) -->
      <StudioSection v-if="isMesh" title="Mesh" badge="layer 1" :open="true">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Drag the dots on the preview to move points. Colours come from the palette below — scatter re-samples them.</p>
        <div class="mb-2 space-y-1">
          <div v-for="(pt, i) in mesh.points" :key="i" class="flex items-center gap-1.5">
            <BindableRow :control-key="`layer.mesh.points.${i}.color`" :label="`Colour ${i + 1}`" kind="color" :bound="boundColumnFor(`layer.mesh.points.${i}.color`)" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
              <StudioColor v-model="pt.color" @update:model-value="(v: string) => onEdit(`layer.mesh.points.${i}.color`, v)" />
            </BindableRow>
            <span class="min-w-0 flex-1 truncate text-[11px] text-white/40">Point {{ i + 1 }} · {{ Math.round(pt.x * 100) }},{{ Math.round(pt.y * 100) }}</span>
            <button v-if="mesh.points.length > 2" class="shrink-0 text-white/30 hover:text-white/70" @click="removeMeshPoint(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="mt-1 flex gap-1.5">
            <button v-if="mesh.points.length < MESH_MAX_POINTS" class="flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/60 hover:text-white" @click="addMeshPoint"><Plus class="h-3 w-3" /> Add point</button>
            <button class="flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/60 hover:text-white" @click="scatterMesh"><Dices class="h-3 w-3" /> Scatter</button>
          </div>
        </div>
        <BindableRow control-key="layer.mesh.softness" label="Softness" kind="slider" :min="10" :max="100" :step="1" :bound="boundColumnFor('layer.mesh.softness')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Softness</span><span class="text-white/40">{{ Math.round(mesh.softness) }}</span></label>
          <input v-model.number="mesh.softness" type="range" min="10" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('layer.mesh.softness', mesh.softness)" />
        </BindableRow>
        <BindableRow control-key="layer.mesh.contrast" label="Contrast" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('layer.mesh.contrast')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Contrast</span><span class="text-white/40">{{ Math.round(mesh.contrast) || 'smooth' }}</span></label>
          <input v-model.number="mesh.contrast" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('layer.mesh.contrast', mesh.contrast)" />
        </BindableRow>
        <BindableRow control-key="layer.mesh.blur" label="Blur" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('layer.mesh.blur')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Blur</span><span class="text-white/40">{{ Math.round(meshBlur) || 'off' }}</span></label>
          <input v-model.number="meshBlur" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('layer.mesh.blur', meshBlur)" />
        </BindableRow>
        <BindableRow control-key="layer.mesh.drift" label="Drift" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('layer.mesh.drift')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Drift</span><span class="text-white/40">{{ Math.round(mesh.drift) || 'still' }}</span></label>
          <input v-model.number="mesh.drift" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('layer.mesh.drift', mesh.drift)" />
        </BindableRow>
      </StudioSection>

      <!-- Relief & grain. Relief + its light only shade the band/ring HEIGHT field (linear/
           radial/orbit/stack); liquid uses flow.depth and mesh has no relief — so on those
           only Grain applies, and the section slims to "Grain". -->
      <StudioSection :title="(isLiquid || isMesh) ? 'Grain' : 'Relief & grain'" :open="false">
        <BindableRow control-key="relief.grain" label="Grain" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('relief.grain')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Grain</span><span class="text-white/40">{{ config.relief.grain.toFixed(2) }}</span></label>
          <input v-model.number="config.relief.grain" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" :class="(!isLiquid && !isMesh) ? 'mb-2' : ''" @input="onEdit('relief.grain', config.relief.grain)" />
        </BindableRow>
        <template v-if="!isLiquid && !isMesh">
          <BindableRow control-key="relief.relief" label="Relief" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('relief.relief')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Relief</span><span class="text-white/40">{{ config.relief.relief.toFixed(2) }}</span></label>
            <input v-model.number="config.relief.relief" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('relief.relief', config.relief.relief)" />
          </BindableRow>
          <BindableRow control-key="relief.light.azimuth" label="Light angle" kind="slider" :min="0" :max="360" :step="1" :bound="boundColumnFor('relief.light.azimuth')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Light angle</span><span class="text-white/40">{{ Math.round(lightAz) }}°</span></label>
            <input v-model.number="lightAz" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('relief.light.azimuth', lightAz)" />
          </BindableRow>
          <BindableRow control-key="relief.light.elevation" label="Light height" kind="slider" :min="0" :max="90" :step="1" :bound="boundColumnFor('relief.light.elevation')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Light height</span><span class="text-white/40">{{ Math.round(lightEl) }}°</span></label>
            <input v-model.number="lightEl" type="range" min="0" max="90" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('relief.light.elevation', lightEl)" />
          </BindableRow>
        </template>
      </StudioSection>

      <!-- Focus / soft-focus DoF -->
      <StudioSection v-if="config.focus" title="Focus" badge="both layers" :open="false">
        <BindableRow control-key="focus.blur" label="Blur" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('focus.blur')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Blur</span><span class="text-white/40">{{ config.focus.blur }}</span></label>
          <input v-model.number="config.focus.blur" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('focus.blur', config.focus.blur)" />
        </BindableRow>
        <BindableRow control-key="focus.shape" label="Focus region" kind="select" :options="['off', 'radial', 'linear']" :bound="boundColumnFor('focus.shape')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 block text-xs text-white/60">Focus region</label>
          <select v-model="config.focus.shape" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize" @change="onEdit('focus.shape', config.focus.shape)">
            <option value="off">Off — blur everything</option>
            <option value="radial">Radial — sharp spot</option>
            <option value="linear">Linear — tilt-shift band</option>
          </select>
        </BindableRow>
        <template v-if="config.focus.shape !== 'off'">
          <BindableRow control-key="focus.radius" label="Focus size" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('focus.radius')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Focus size</span><span class="text-white/40">{{ config.focus.radius.toFixed(2) }}</span></label>
            <input v-model.number="config.focus.radius" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('focus.radius', config.focus.radius)" />
          </BindableRow>
          <BindableRow control-key="focus.softness" label="Focus falloff" kind="slider" :min="0" :max="100" :step="1" :bound="boundColumnFor('focus.softness')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Falloff</span><span class="text-white/40">{{ config.focus.softness }}</span></label>
            <input v-model.number="config.focus.softness" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('focus.softness', config.focus.softness)" />
          </BindableRow>
          <BindableRow control-key="focus.x" label="Focus X" kind="slider" :min="-0.5" :max="0.5" :step="0.01" :bound="boundColumnFor('focus.x')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Focus X</span><span class="text-white/40">{{ config.focus.x.toFixed(2) }}</span></label>
            <input v-model.number="config.focus.x" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('focus.x', config.focus.x)" />
          </BindableRow>
          <BindableRow control-key="focus.y" label="Focus Y" kind="slider" :min="-0.5" :max="0.5" :step="0.01" :bound="boundColumnFor('focus.y')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Focus Y</span><span class="text-white/40">{{ config.focus.y.toFixed(2) }}</span></label>
            <input v-model.number="config.focus.y" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range w-full" :class="config.focus.shape === 'linear' ? 'mb-2' : ''" @input="onEdit('focus.y', config.focus.y)" />
          </BindableRow>
          <template v-if="config.focus.shape === 'linear'">
            <BindableRow control-key="focus.angle" label="Band angle" kind="slider" :min="0" :max="360" :step="1" :bound="boundColumnFor('focus.angle')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
              <label class="mb-1 flex justify-between text-xs text-white/60"><span>Band angle</span><span class="text-white/40">{{ config.focus.angle }}°</span></label>
              <input v-model.number="config.focus.angle" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('focus.angle', config.focus.angle)" />
            </BindableRow>
          </template>
        </template>
      </StudioSection>

      <!-- Layer (blend/opacity for the active non-base layer; add/remove/reorder/select
           now live in the aside StudioLayerStack) -->
      <StudioSection title="Layer" :open="false">
        <template v-if="activeLayer > 0">
          <BindableRow control-key="layer.blend" label="Blend" kind="select" :options="[...BLEND_MODES]" :bound="boundColumnFor('layer.blend')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 block text-xs text-white/60">Blend</label>
            <select v-model="layer.blend" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize" @change="onEdit('layer.blend', layer.blend)">
              <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
            </select>
          </BindableRow>
          <BindableRow control-key="layer.opacity" label="Opacity" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('layer.opacity')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Opacity</span><span class="text-white/40">{{ layer.opacity.toFixed(2) }}</span></label>
            <input v-model.number="layer.opacity" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" @input="onEdit('layer.opacity', layer.opacity)" />
          </BindableRow>
        </template>
      </StudioSection>

      <!-- Shape -->
      <StudioSection v-if="!isLiquid && !isMesh" title="Shape" :badge="`Layer ${activeLayer + 1}`">
        <div v-if="!isStack" class="mb-2 grid grid-cols-4 gap-1">
          <button v-for="s in SHAPE_KINDS" :key="s" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.type === s ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setShape(s)">{{ s }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>{{ isStack ? 'Ring count' : 'Count' }}</span><span class="text-white/40">{{ Math.round(layer.shape.count) }}</span></label>
        <input v-model.number="layer.shape.count" type="range" min="2" :max="isStack ? 40 : 64" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <template v-if="isStack">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Rotation / ring</span><span class="text-white/40">{{ Math.round(layer.shape.rotStep ?? 8) }}°</span></label>
          <input v-model.number="layer.shape.rotStep" type="range" min="0" max="45" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Pivot</span><span class="text-white/40">{{ (layer.shape.pivot ?? 0.1).toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.pivot" type="range" min="0" max="0.6" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Disc size</span><span class="text-white/40">{{ (layer.shape.ringScale ?? 1).toFixed(2) }}×</span></label>
          <input v-model.number="layer.shape.ringScale" type="range" min="1" max="2.2" step="0.02" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 block text-xs text-white/60">Ring shape</label>
          <div class="grid grid-cols-3 gap-1">
            <button v-for="rs in RING_SHAPES" :key="rs" class="rounded px-1 py-1 text-[11px] capitalize transition"
                    :class="(layer.shape.ringShape ?? 'circle') === rs ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.shape.ringShape = rs">{{ rs }}</button>
          </div>
        </template>
        <template v-if="!isStack">
        <template v-if="layer.shape.type === 'wave' || layer.shape.type === 'bands'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Peaks</span><span class="text-white/40">{{ Math.round(layer.shape.peaks) }}</span></label>
          <input v-model.number="layer.shape.peaks" type="range" min="1" max="12" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Wave phase</span><span class="text-white/40">{{ layer.shape.phase.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.phase" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else-if="layer.shape.type === 'noise'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Detail</span><span class="text-white/40">{{ Math.round(layer.shape.detail) }}</span></label>
          <input v-model.number="layer.shape.detail" type="range" min="1" max="8" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Valley position</span><span class="text-white/40">{{ layer.shape.valley.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.valley" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Min depth</span><span class="text-white/40">{{ layer.shape.minDepth.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.minDepth" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Curve exponent</span><span class="text-white/40">{{ layer.shape.curveExp.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.curveExp" type="range" min="0.2" max="3" step="0.05" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>{{ layer.shape.type === 'bands' ? 'Randomness' : 'Jitter' }}</span><span class="text-white/40">{{ layer.shape.jitter.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.jitter" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Gap</span><span class="text-white/40">{{ layer.shape.gap.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.gap" type="range" min="0" max="0.8" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Rounding</span><span class="text-white/40">{{ layer.shape.rounding.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.rounding" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <template v-if="isRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Sweep</span><span class="text-white/40">{{ Math.round(layer.shape.sweep) }}°</span></label>
          <input v-model.number="layer.shape.sweep" type="range" min="20" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub / rotate</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 block text-xs text-white/60">Direction</label>
          <div class="mb-2 grid grid-cols-4 gap-1">
            <button v-for="d in DIRECTIONS" :key="d" class="rounded py-1 text-xs transition"
                    :class="layer.shape.direction === d ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.shape.direction = d">{{ { up: '↑', right: '→', down: '↓', left: '←' }[d] }}</button>
          </div>
        </template>
        <label class="mb-1 block text-xs text-white/60">Mirror</label>
        <div class="grid grid-cols-4 gap-1">
          <button v-for="mk in MIRROR_KINDS" :key="mk" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.mirror === mk ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="layer.shape.mirror = mk">{{ mk === 'horizontal' ? 'Horiz' : mk === 'vertical' ? 'Vert' : mk }}</button>
        </div>
        </template>
      </StudioSection>

      <!-- Color -->
      <StudioSection title="Color" :badge="isMesh ? 'mesh palette' : `Layer ${activeLayer + 1}`">
        <p v-if="isMesh" class="mb-2 text-[11px] leading-snug text-white/40">The palette mesh points are sampled from when you scatter or randomize colours.</p>
        <div class="mb-2 space-y-1">
          <div v-for="(stop, i) in layer.color.stops" :key="i" class="flex items-center gap-1.5">
            <BindableRow :control-key="`layer.color.stops.${i}.color`" :label="`Colour ${i + 1}`" kind="color" :bound="boundColumnFor(`layer.color.stops.${i}.color`)" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
              <StudioColor v-model="stop.color" @update:model-value="(v: string) => onEdit(`layer.color.stops.${i}.color`, v)" />
            </BindableRow>
            <input v-studio-reset v-model.number="stop.pos" type="range" min="0" max="1" step="0.01" class="studio-range min-w-0 flex-1" />
            <span class="w-9 shrink-0 text-right text-[10px] text-white/40">{{ Math.round(stop.pos * 100) }}%</span>
            <button v-if="layer.color.stops.length > 2" class="shrink-0 text-white/30 hover:text-white/70" @click="removeStop(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <button class="mt-1 flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/60 hover:text-white" @click="addStop"><Plus class="h-3 w-3" /> Add stop</button>
        </div>
        <div class="mb-3 border-t border-white/[0.06] pt-2">
          <PalettePicker mode="stops" :stop-count="layer.color.stops.length" :seed="layer.color.stops[0]?.color ?? '#4f8ad9'" @apply-stops="applyPaletteStops" />
        </div>
        <template v-if="!isMesh">
          <label class="mb-1 block text-xs text-white/60">Gradient direction</label>
          <div class="mb-2 grid grid-cols-2 gap-1">
            <button v-for="gd in GRADIENT_DIRS" :key="gd" class="rounded px-1 py-1 text-[11px] capitalize transition"
                    :class="layer.color.gradientDir === gd ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.color.gradientDir = gd">{{ gd }}</button>
          </div>
          <label class="mb-1 block text-xs text-white/60">Mapping</label>
          <div class="mb-2 grid grid-cols-3 gap-1">
            <button v-for="mp in MAPPINGS" :key="mp" class="rounded px-1 py-1 text-[11px] capitalize transition"
                    :class="layer.color.mapping === mp ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.color.mapping = mp">{{ mp }}</button>
          </div>
          <BindableRow control-key="layer.color.steps" label="Posterize steps" kind="slider" :min="0" :max="24" :step="1" :bound="boundColumnFor('layer.color.steps')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Steps</span><span class="text-white/40">{{ layer.color.steps || 'off' }}</span></label>
            <input v-model.number="layer.color.steps" type="range" min="0" max="24" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('layer.color.steps', layer.color.steps)" />
          </BindableRow>
          <BindableRow control-key="layer.color.hueDrift" label="Hue drift" kind="slider" :min="-180" :max="180" :step="1" :bound="boundColumnFor('layer.color.hueDrift')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue drift</span><span class="text-white/40">{{ Math.round(layer.color.hueDrift) }}°</span></label>
            <input v-model.number="layer.color.hueDrift" type="range" min="-180" max="180" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('layer.color.hueDrift', layer.color.hueDrift)" />
          </BindableRow>
        </template>
        <BindableRow control-key="layer.color.hueRotate" label="Hue rotate" kind="slider" :min="0" :max="360" :step="1" :bound="boundColumnFor('layer.color.hueRotate')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue rotate</span><span class="text-white/40">{{ Math.round(layer.color.hueRotate) }}°</span></label>
          <input v-model.number="layer.color.hueRotate" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range w-full" @input="onEdit('layer.color.hueRotate', layer.color.hueRotate)" />
        </BindableRow>
      </StudioSection>

      <!-- Motion -->
      <StudioSection title="Motion" :open="false">
        <template #badge>
          <button class="flex items-center gap-1 normal-case text-white/40 hover:text-white" @click.stop="addTrack"><Plus class="h-3 w-3" /> Track</button>
        </template>
        <p v-if="!config.motion.tracks.length" class="text-[11px] text-white/30">Add a track to animate a parameter and export video.</p>
        <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
          <div class="mb-1 flex items-center gap-1">
            <select v-model="tk.path" class="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option v-if="tk.path && !animatable.some(a => a.path === tk.path)" :value="tk.path">{{ tk.path }}</option>
              <option v-for="a in animatable" :key="a.path" :value="a.path">{{ a.label }}</option>
            </select>
            <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="mb-1 flex items-center gap-1 text-[11px] text-white/50">
            <span>from</span><input v-model.number="tk.from" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
            <span>to</span><input v-model.number="tk.to" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
          </div>
          <div class="flex items-center gap-1">
            <select v-model="tk.easing" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option value="linear">Linear</option><option value="pingpong">Ping-pong</option><option value="easeinout">Ease</option>
            </select>
            <select v-model.number="tk.loops" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
            </select>
            <span class="text-[11px] text-white/40">loops</span>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label>
            <input v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" v-studio-reset class="studio-range w-full" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/60">FPS</label>
            <select v-model.number="config.motion.fps" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option :value="24">24</option><option :value="30">30</option><option :value="60">60</option>
            </select>
          </div>
        </div>
        <div class="mt-1 text-[10px] text-white/30">{{ Math.round(config.motion.fps * config.motion.duration) }} frames</div>
      </StudioSection>

      <!-- Export -->
      <StudioSection title="Export" :open="false">
        <div class="grid grid-cols-2 gap-1.5">
          <button v-for="f in (['png', 'jpg'] as const)" :key="f" class="rounded border px-2 py-1.5 text-xs transition"
                  :class="exportFormat === f ? 'border-white/30 bg-white/15 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportFormat = f">{{ f.toUpperCase() }}</button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="r in EXPORT_RES" :key="r.w" class="rounded border px-1 py-1.5 text-xs transition"
                  :class="exportResW === r.w ? 'border-white/30 bg-white/15 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportResW = r.w">{{ r.label }}</button>
        </div>
        <div class="text-[10px] text-white/30">{{ exportDims.w }} × {{ exportDims.h }} · {{ exportFormat.toUpperCase() }}</div>
        <button class="w-full rounded bg-white/10 px-3 py-2 text-xs text-white/80 transition hover:bg-white/20" @click="downloadExport">
          Export {{ exportFormat.toUpperCase() }} <span class="text-white/30">E</span>
        </button>
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
