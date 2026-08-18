<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { Dices, Lock, Minus, Plus, Trash2, Unlock } from 'lucide-vue-next'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { LIQUID_PRESETS, buildConfig, defaultConfig, liquidConfig, liquidPresetConfig, meshConfig, reroll, rippleConfig, stackConfig, type RerollScope } from '~/lib/gradientfx/randomize'
import { MESH_MAX_POINTS, buildMeshPoints, defaultMesh } from '~/lib/gradientfx/mesh'
import { randomSeed } from '~/lib/gradientfx/rng'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { encodeFrames } from '~/lib/engine/encodeVideo'
import { useStudioAutosave } from '~/lib/studio/autosave'
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'
import { animatableTargets, dropTracksForLayer, remapTracksOnInsert, remapTracksOnReorder } from '~/lib/gradientfx/motion'
import { GRADIENT_CONTROLS } from '~/lib/gradientfx/controls'
import { layerLabels } from '~/lib/gradientfx/layerLabel'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioLayerStack from '~/components/vue-canvas/StudioLayerStack.vue'
import CurveHandleEditor from '~/components/vue-canvas/CurveHandleEditor.vue'
import StudioActionsFooter from '~/components/vue-canvas/studio/StudioActionsFooter.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import BindableRow from '~/components/vue-canvas/studio/BindableRow.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import PalettePicker from '~/components/vue-canvas/studio/PalettePicker.vue'
import CanvasContextMenu from '~/components/vue-canvas/CanvasContextMenu.vue'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import { POST_SECTIONS } from '~/lib/studio/post/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { useStudioVarMenu } from '~/composables/useStudioVarMenu'
import { makeConfigParams } from '~/lib/agent/configParams'
import { GRADIENT_GUIDANCE, gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { showIfVisible } from '~/lib/studio/sections'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import { exportEmbedHtml, downloadEmbed } from '~/lib/embed/export'
import type { GradientEmbedConfig } from '~/lib/embed/surfaces/gradient'
import { clampExportDims } from '~/lib/gradientfx/exportDims'
import {
  ASPECTS, BLEND_MODES, CURVE_DEFAULTS, DEFAULT_FOCUS, DIRECTIONS, GRADIENT_DIRS, LAYER_MAX, LAYOUTS, LAYOUT_LABELS, MAPPINGS, MIRROR_KINDS, RAMP_DEFAULTS, RING_SHAPES, SHAPE_KINDS,
  aspectRatio, cloneConfig, effectiveLayout, ensureConfigDefaults, type GradientConfig, type LayoutKind, type MeshConfig, type ShapeKind,
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
// The active layer's own layout override, else the canvas default (layer 0 always
// anchors to canvas.layout — see setLayout). Every layout-gated computed below reads
// THIS, not config.value.canvas.layout, so the inspector reflects whichever layer is
// selected in the layer stack, not just layer 0.
const activeLayout = computed(() => effectiveLayout(config.value, activeLayer.value))
const isRadial = computed(() => activeLayout.value === 'radial' || activeLayout.value === 'orbit')
const isStack = computed(() => activeLayout.value === 'stack')
// The stripe/band family (linear/radial/orbit/stack) — the ONLY layouts whose render
// uses the shape field, margin, and 3D relief. Simple primitives, liquid and mesh
// ignore them. `isBanded` gates the PER-LAYER Shape section on the active layer.
const isBanded = computed(() => ['linear', 'radial', 'orbit', 'stack'].includes(activeLayout.value))
// GLOBAL controls (canvas.margin/innerRadius/center, relief.*) live on the whole
// gradient, not one layer — they must show whenever ANY layer in the stack uses them,
// or they'd flicker wrong in a mixed stack (e.g. Relief hiding when you select a curve
// layer while it's still embossing the stripe base). Relief is layer-0-only in the
// shader, so it keys off layer 0 specifically.
const someLayerIs = (kinds: string[]) => config.value.layers.some((_l, i) => kinds.includes(effectiveLayout(config.value, i)))
const anyBanded = computed(() => someLayerIs(['linear', 'radial', 'orbit', 'stack']))
const baseBanded = computed(() => ['linear', 'radial', 'orbit', 'stack'].includes(effectiveLayout(config.value, 0)))
const anyInnerRadius = computed(() => someLayerIs(['radial', 'orbit', 'radialRamp']))   // conic does NOT use innerRadius
const anyCenter = computed(() => someLayerIs(['radial', 'orbit', 'radialRamp', 'conic']))
const isLiquid = computed(() => activeLayout.value === 'liquid')
// The flow.* highlight/shadow/gloss/ripple uniforms are GLOBAL and the shader only
// applies them under `u_layout[0]` (layer 0's layout == liquid) — never per-layer. So
// they must gate on whether the BASE layer is liquid, not the active one (same
// layer-0-anchor as baseBanded/Relief). Depth/foldScale/veins/refract stay isLiquid:
// those DO have a genuine per-layer effect inside computeLayer.
const baseLiquid = computed(() => effectiveLayout(config.value, 0) === 'liquid')
const isMesh = computed(() => activeLayout.value === 'mesh')
const isCurve = computed(() => activeLayout.value === 'curve')
// Gradient axis block — the three simple primitives share one "Gradient" section;
// which controls it shows depends on which of the three is active.
const isSimpleRamp = computed(() => ['ramp', 'radialRamp', 'conic'].includes(activeLayout.value))
const isRampAngle = computed(() => activeLayout.value === 'ramp' || activeLayout.value === 'conic')
const isRampRadial = computed(() => activeLayout.value === 'radialRamp')
const isConic = computed(() => activeLayout.value === 'conic')
// Center + inner radius are used by the stripe polar layouts (radial/orbit) AND the
// simple radial/conic primitives — NOT plain linear ramp, which has no origin.
// Layers are named for what they are ("Wave", "Bands"), not their position, so a
// reorder moves a recognisable name instead of renumbering the whole stack.
const layerNames = computed(() => layerLabels(config.value))

// Inspector tabs — Design (everything that shapes the still frame) vs Motion (tracks
// + timing), matching Space Type and 3D Studio. Export stays on Design: it writes a
// still, while Motion owns the animation the Render footer bakes to video.
const inspectorTab = ref<'design' | 'motion'>('design')
const onDesign = computed(() => inspectorTab.value === 'design')
const onMotion = computed(() => inspectorTab.value === 'motion')
// Focus (soft-focus/DoF) is an optional, additive config. Guarantee it exists on
// the current config so the Focus section's v-models are always non-null — presets
// replace the whole config and defaultConfig() omits it. Runs before render.
watch(config, (c) => { if (c && !c.focus) c.focus = { ...DEFAULT_FOCUS } }, { immediate: true, flush: 'sync' })
// Same guarantee for post: defaultConfig()/randomize.ts's builders always set it now,
// but a config loaded from an OLDER saved node blob (pre-this-task) or a not-yet-
// updated preset would otherwise leave config.value.post undefined until the next
// ensureConfigDefaults pass, and the Post panel's v-models need it non-null immediately.
watch(config, (c) => { if (c && !c.post) c.post = { ...DEFAULT_POST } }, { immediate: true, flush: 'sync' })

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
const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes, edges: () => props.edges ?? [] },
)

const { wiredColumns, sweepPopover, applySweep, varMenu, openVarMenu, goToCollection } = useStudioVarMenu({
  nodeId: () => props.nodeId,
  nodes: () => props.nodes,
  edges: () => props.edges ?? [],
  liveValue: (key) => paramsProxy[key] as string | number,
  boundColumnFor, boundColumnKeyFor, promote, unbind,
})

// ── shared post stack (Bloom/Color/Duotone/... — see ~/lib/studio/post) ────────
// StudioControlPanel is handed the FULL GRADIENT_CONTROLS array (the single source
// controls.ts already appends postControls() to) and the POST_SECTIONS allow-list,
// which groupIntoSections() uses to pick out only the post.* controls — same
// pattern Texture/Shape Studio use for their own schema-driven panels.
function setPostControl(key: string, value: string | number | boolean) {
  paramsProxy[key] = value as string | number
  onEdit(key, value as string | number)
}
function promotePostControl(c: ControlSpec) {
  promote(c, paramsProxy[c.key] as string | number)
}
/** A param row (e.g. Bloom's strength/radius/threshold) only shows once its effect's
 *  own switch is on. The rule itself lives in ~/lib/studio/sections — it used to be
 *  copy-pasted here and in SpaceTypeSurface, and missing from Texture and Shape. */
function postControlVisible(c: ControlSpec): boolean {
  return showIfVisible(c, k => paramsProxy[k])
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
const embedMsg = ref('')
const embedErr = ref(false)
const embedding = ref(false)
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

// Sticky footer status (StudioActionsFooter): real Saving…/Saved ✓ driven by
// useStudioAutosave, debounced off `config` — the studio's single source of
// truth, which saveConfig() clones straight onto the node (never written back
// into `config`, so there's no watch loop). Nothing mutates `config` on a
// per-frame/rAF cadence (renderFrame/loop only READ it to draw the preview),
// so watching the live ref directly (rather than a serialized signature, as
// Space Type/Scene3D need for their reactive sibling refs) is safe here.
const { saving: autoSaving, saved: autoSaved } = useStudioAutosave(() => config.value, saveConfig)

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
    if (!blob) { bakeMsg.value = ''; return }
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    const [filename] = await uploadFrameBatch([blob], 'gradient_img')
    if (filename) {
      const n = currentNode()
      if (n) { n.data ||= {}; n.data.properties ||= {}; saveConfig() }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:gradientStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      // Clear the in-flight message on success so the footer's `notice` (no longer
      // gated behind `baking` now that StudioActionsFooter reads it unconditionally)
      // doesn't keep showing "Rendering…" after the fact. closeEditor() unmounts this
      // surface in normal use, but clear it anyway rather than depend on that timing.
      bakeMsg.value = ''
      closeEditor()
    } else {
      // uploadFrameBatch swallows a failed upload and returns [] — surface it instead of
      // leaving the footer stuck on "Rendering…" forever.
      bakeMsg.value = 'Upload failed — see console.'
    }
  } catch (e) { console.error('[gradient] image generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

// Shared full-res blob capture — same render call `generateImage` uses, factored
// out so the param baker below (and any future caller) stays byte-identical.
async function renderCurrentBlob(): Promise<Blob | null> {
  const { w, h } = exportDims.value
  const { w: cw, h: ch } = clampExportDims(w, h)
  return await gradientFx.renderToBlob(config.value, cw, ch, 0)
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

/** Bake the current Gradient state to frames at `motion.fps`/`motion.duration`
 *  and encode server-side to a video file under input/. Shared by generateVideo()
 *  (dispatches a Video node onto the canvas) and downloadVideoFile() (saves the
 *  file locally) so this frame-bake exists in exactly one place. Callers own
 *  baking.value/stopPreview/startPreview. A bake-stage failure (ensureSpaceTypeBake)
 *  propagates to the caller; an encode-stage failure is caught here (mirrors the
 *  original generateVideo's nested try/catch) and reported via bakeMsg, returning
 *  null so callers treat it as "nothing to dispatch/download" without their own
 *  catch firing a second, more generic message. */
async function bakeGradientVideo(): Promise<{ filename: string; ext: 'mp4' | 'webm' } | null> {
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
  try {
    return await encodeFrames({ frames: bake.frames, fps: m.fps, width: w, height: h })
  } catch (encErr) {
    bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'
    console.error('[gradient] encode failed', encErr)
    return null
  }
}

async function generateVideo() {
  baking.value = true
  stopPreview()
  try {
    const encoded = await bakeGradientVideo()
    if (!encoded) return
    await recordAsset(activeTab.value?.projectUuid, 'video', encoded.filename)
    window.dispatchEvent(new CustomEvent('sailor:gradientStudioOutput', {
      detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: encoded.filename } },
    }))
    bakeMsg.value = ''
    closeEditor()
  } catch (e) { console.error('[gradient] video generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

/** Download the current full-res still as a PNG — same render call generateImage()
 *  uses (renderCurrentBlob), just saved locally instead of dispatched to the canvas. */
async function downloadPng() {
  const blob = await renderCurrentBlob()
  if (blob) downloadBlobAsFile(blob, `gradient_${Date.now()}.png`)
}

/** Same bake as generateVideo(), but saves the encoded file locally instead of
 *  dispatching a Video node onto the canvas. Unlike generateVideo/generateImage,
 *  this never calls closeEditor() — the modal stays open (see the plan) — so
 *  bakeMsg MUST be cleared on success here, or the footer's notice would show a
 *  stale "Encoding…" forever instead of returning to idle. */
async function downloadVideoFile() {
  baking.value = true
  stopPreview()
  try {
    const encoded = await bakeGradientVideo()
    if (!encoded) return
    // NOT `/input/${filename}` — that path isn't in the Nuxt dev server's
    // comfyui-proxy PROXY_PREFIXES (server/middleware/comfyui-proxy.ts only
    // proxies /view, /upload, etc.) and 404s; verified live. ComfyUI's own
    // /view endpoint (proxied) serves the same input/ file by filename+type.
    const res = await fetch(`/view?${new URLSearchParams({ filename: encoded.filename, type: 'input' })}`)
    if (!res.ok) throw new Error(`/view returned ${res.status}`)
    downloadBlobAsFile(await res.blob(), `gradient_${Date.now()}.${encoded.ext}`)
    bakeMsg.value = ''
  } catch (e) { console.error('[gradient] video download failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

async function exportWebEmbed() {
  // Disabled while in flight (see the button below): a double-click otherwise
  // starts two full-resolution GL bakes and downloads two files.
  if (embedding.value) return
  embedding.value = true
  embedErr.value = false
  embedMsg.value = 'Building…'
  try {
    // Same sizing as the still-image export path (downloadExport/renderCurrentBlob
    // above) — do not invent new sizing logic here. clampExportDims scales both
    // axes together so a non-square aspect (e.g. 9:16 at 4K) doesn't get
    // squashed into a square by an independent per-axis clamp.
    const { w, h } = exportDims.value
    const { w: ew, h: eh } = clampExportDims(w, h)
    // Matches the studio's own loop(): frameSource.ts always derives duration
    // from cfg.motion.duration.
    const duration = config.value.motion?.duration ?? 4

    // Gradient is fully procedural — no source image, no EffectDefs to filter —
    // so unlike the shader adapter's config, this is just the config plus the
    // loop duration. See GradientEmbedConfig in ~/lib/embed/surfaces/gradient.
    const embedConfig: GradientEmbedConfig = {
      cfg: structuredClone(toRaw(config.value)),
      duration,
    }

    const html = await exportEmbedHtml({
      kind: 'gradient',
      config: embedConfig,
      duration,
      width: ew,
      height: eh,
    })

    // Size is shown BEFORE the download, not discovered later. Still one
    // action — no confirmation dialog.
    const kb = (new Blob([html]).size / 1024).toFixed(0)
    embedMsg.value = `${kb} KB — downloading…`
    await nextTick()
    downloadEmbed('sailor-gradient-embed.html', html)
    embedMsg.value = `Downloaded — ${kb} KB`
  } catch (err) {
    console.error('[GradientStudio] embed export failed:', err)
    embedErr.value = true
    embedMsg.value = err instanceof Error ? err.message : 'Export failed'
  } finally {
    embedding.value = false
  }
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
  // Layer 0 has no override of its own — it anchors to canvas.layout, so writing
  // there (and clearing any stray layers[0].layout) is how layer 0 changes layout.
  // Layers 1+ get their own per-layer override; canvas.layout is untouched.
  if (activeLayer.value === 0) {
    config.value.canvas.layout = l
    delete config.value.layers[0]!.layout
  } else {
    config.value.layers[activeLayer.value]!.layout = l
  }
  // Backfill stack params so the sliders + render agree the moment you switch to Stack.
  if (l === 'stack') {
    const s = layer.value.shape
    if (s.rotStep == null) s.rotStep = 8
    if (s.pivot == null) s.pivot = 0.1
    if (s.ringScale == null) s.ringScale = 1
    if (s.ringShape == null) s.ringShape = 'circle'
  }
  // Mesh reads layer-0 points; create them (from the current palette) on first switch.
  // Excluded from the picker on layers 1+ (see LAYOUTS filter below), so this only
  // ever fires with activeLayer already 0 — the guard just documents that invariant.
  if (l === 'mesh' && activeLayer.value === 0) { ensureMesh() }
}
function setShape(s: ShapeKind) { layer.value.shape.type = s }

// Simple-primitive axis (ramp/radialRamp/conic). `layer.ramp` is optional for
// back-compat and isn't backfilled by setLayout (only ensureConfigDefaults does
// that, at load) — so a layer that has never carried an axis needs the FULL
// RAMP_DEFAULTS seeded on first touch, not just the one field being edited.
// The renderer falls back to RAMP_DEFAULTS wholesale when `ramp` is absent
// (`L.ramp ?? RAMP_DEFAULTS`), so a partial object here would leave the other
// axis fields undefined instead of defaulted.
// `onEdit` only accepts string|number (it write-throughs to a bound Collection
// cell), so closeLoop's boolean skips that call — same posture as the
// direction/mapping buttons above, which mutate config directly with no bind path.
function onRamp(key: 'angle' | 'radius' | 'shape' | 'sweep' | 'closeLoop', value: number | string | boolean) {
  const L = layer.value
  if (!L.ramp) L.ramp = { ...RAMP_DEFAULTS }
  ;(L.ramp as any)[key] = value
  if (typeof value !== 'boolean') onEdit(`layer.ramp.${key}`, value)
}
// Curve dials (curve layout only). Mirrors onRamp above: `layer.curve` is optional
// for back-compat and isn't backfilled by setLayout (only ensureConfigDefaults does
// that, at load — same posture as `layer.ramp`) — seed the FULL CURVE_DEFAULTS, with
// fresh start/end objects (not shared references), on first touch. Also the sink for
// CurveHandleEditor's drag emits: `path` arrives as 'layer.curve.start.x',
// 'layer.curve.mode', etc. — the two Vec2 fields are written component-by-component;
// everything else writes straight onto the curve object by its remaining key.
function onCurve(path: string, value: number | string) {
  const L = layer.value
  if (!L.curve) L.curve = { ...CURVE_DEFAULTS, start: { ...CURVE_DEFAULTS.start }, end: { ...CURVE_DEFAULTS.end } }
  const rest = path.replace(/^layer\.curve\./, '')
  if (rest === 'start.x') L.curve.start.x = value as number
  else if (rest === 'start.y') L.curve.start.y = value as number
  else if (rest === 'end.x') L.curve.end.x = value as number
  else if (rest === 'end.y') L.curve.end.y = value as number
  else (L.curve as any)[rest] = value
  onEdit(path, value)
}
// Repeat/falloff live on `layer.color`, which is never optional, so — unlike
// onRamp — there's no container to seed first.
function onColor(key: 'repeat' | 'repeatCount' | 'falloff', value: number | string) {
  const L = layer.value
  ;(L.color as any)[key] = value
  onEdit(`layer.color.${key}`, value)
}
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
        :layers="config.layers.map((l, i) => ({ label: layerNames[i] ?? `Layer ${i + 1}`, enabled: layerEnabled(i) }))"
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
        <!-- Curve layout: draggable start/end/curvature handles overlaid on the
             preview, writing straight into layer.curve.* (see onCurve above). Uses
             the canvas element directly (same getBoundingClientRect tracking as
             StringPathEditor/LoftSpineEditor) so it stays aligned through the
             preview's own pan/zoom CSS transform. -->
        <CurveHandleEditor v-if="isCurve" class="z-30" :model-value="layer.curve ?? CURVE_DEFAULTS" :canvas="canvas" @edit="onCurve" />
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
      <StudioActionsFooter :spec="{
        status: {
          saving: autoSaving, saved: autoSaved,
          error: glError || (embedErr ? embedMsg : null),
          notice: (!embedErr && embedMsg) ? embedMsg : (bakeMsg || null),
        },
        utilities: [{ label: copied ? '✓ Copied' : 'Copy config', onClick: copyConfig }],
        downloads: [
          { label: 'Download PNG', onClick: downloadPng },
          { label: 'Download video', onClick: downloadVideoFile, busy: baking },
          { label: 'Export embed', onClick: exportWebEmbed, busy: embedding },
        ],
        canvas: [
          { label: 'As image', onClick: generateImage, busy: baking },
          { label: 'As video', onClick: generateVideo, busy: baking },
        ],
      }" />
    </template>

    <template #controls>
      <!-- Design | Motion — same split as Space Type and 3D Studio. -->
      <div class="flex shrink-0 gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="onDesign ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'design'">Design</button>
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="onMotion ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'motion'">
          Motion<span v-if="config.motion.tracks.length" class="ml-1 text-white/40">{{ config.motion.tracks.length }}</span>
        </button>
      </div>

      <!-- Canvas -->
      <StudioSection v-show="onDesign" title="Canvas" badge="both layers">
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
          <button v-for="l in (activeLayer > 0 ? LAYOUTS.filter((x) => x !== 'mesh') : LAYOUTS)" :key="l" class="rounded px-1 py-1 text-[11px] transition"
                  :class="activeLayout === l ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setLayout(l)">{{ LAYOUT_LABELS[l] }}</button>
        </div>
        <!-- GLOBAL controls: show whenever ANY layer in the stack uses them (not just the
             active one), since they live on the whole gradient. -->
        <template v-if="anyBanded">
          <StudioSlider label="Margin" :min="0" :max="0.45" :step="0.01"
            :model-value="config.canvas.margin"
            :bound="boundColumnFor('canvas.margin')"
            @update:model-value="(v: number) => { config.canvas.margin = v; onEdit('canvas.margin', v) }"
            @promote="promote({ key: 'canvas.margin', label: 'Margin', kind: 'slider', min: 0, max: 0.45, step: 0.01 }, config.canvas.margin)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'canvas.margin', label: 'Margin', kind: 'slider', min: 0, max: 0.45, step: 0.01 })" />
        </template>
        <!-- Inner radius: radial/orbit/radialRamp only (conic never reads it). Center: those + conic. -->
        <template v-if="anyInnerRadius">
          <StudioSlider label="Inner radius" :min="0" :max="0.9" :step="0.01"
            :model-value="config.canvas.innerRadius"
            :bound="boundColumnFor('canvas.innerRadius')"
            @update:model-value="(v: number) => { config.canvas.innerRadius = v; onEdit('canvas.innerRadius', v) }"
            @promote="promote({ key: 'canvas.innerRadius', label: 'Inner radius', kind: 'slider', min: 0, max: 0.9, step: 0.01 }, config.canvas.innerRadius)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'canvas.innerRadius', label: 'Inner radius', kind: 'slider', min: 0, max: 0.9, step: 0.01 })" />
        </template>
        <template v-if="anyCenter">
          <StudioSlider label="Center X" :min="-0.5" :max="0.5" :step="0.01"
            :model-value="centerX"
            :bound="boundColumnFor('canvas.center.x')"
            @update:model-value="(v: number) => { centerX = v; onEdit('canvas.center.x', v) }"
            @promote="promote({ key: 'canvas.center.x', label: 'Center X', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 }, centerX)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'canvas.center.x', label: 'Center X', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 })" />
          <StudioSlider label="Center Y" :min="-0.5" :max="0.5" :step="0.01"
            :model-value="centerY"
            :bound="boundColumnFor('canvas.center.y')"
            @update:model-value="(v: number) => { centerY = v; onEdit('canvas.center.y', v) }"
            @promote="promote({ key: 'canvas.center.y', label: 'Center Y', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 }, centerY)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'canvas.center.y', label: 'Center Y', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 })" />
        </template>
        <label class="mb-1 block text-xs text-white/60">Background</label>
        <BindableRow control-key="canvas.background" label="Background" kind="color" :bound="boundColumnFor('canvas.background')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <StudioColor v-model="config.canvas.background" @update:model-value="(v: string) => onEdit('canvas.background', v)" />
        </BindableRow>
      </StudioSection>

      <!-- Color -->
      <StudioSection v-show="onDesign" title="Color" :badge="isMesh ? 'mesh palette' : (layerNames[activeLayer] ?? `Layer ${activeLayer + 1}`)">
        <!-- Gradient axis — the simple primitives (Linear / Radial / Conic) each carry
             a per-layer axis (angle / radius+shape / sweep+closeLoop) that the other
             six layouts don't have a slot for. Folded in here (was its own "Gradient"
             section) so the ramp's geometry sits right above the ramp's colour. -->
        <template v-if="isRampAngle">
          <StudioSlider label="Angle" :min="0" :max="360" :step="1" :default="90"
            :model-value="layer.ramp?.angle ?? 90"
            :bound="boundColumnFor('layer.ramp.angle')"
            @update:model-value="(v: number) => onRamp('angle', v)"
            @promote="promote({ key: 'layer.ramp.angle', label: 'Angle', kind: 'slider', min: 0, max: 360, step: 1 }, layer.ramp?.angle ?? 90)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.ramp.angle', label: 'Angle', kind: 'slider', min: 0, max: 360, step: 1 })" />
        </template>
        <template v-if="isRampRadial">
          <StudioSlider label="Radius" :min="0.05" :max="2" :step="0.01" :default="1"
            :model-value="layer.ramp?.radius ?? 1"
            :bound="boundColumnFor('layer.ramp.radius')"
            @update:model-value="(v: number) => onRamp('radius', v)"
            @promote="promote({ key: 'layer.ramp.radius', label: 'Radius', kind: 'slider', min: 0.05, max: 2, step: 0.01 }, layer.ramp?.radius ?? 1)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.ramp.radius', label: 'Radius', kind: 'slider', min: 0.05, max: 2, step: 0.01 })" />
          <BindableRow control-key="layer.ramp.shape" label="Radial shape" kind="select" :options="['circle', 'ellipse']" :bound="boundColumnFor('layer.ramp.shape')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 block text-xs text-white/60">Shape</label>
            <select :value="layer.ramp?.shape ?? 'circle'" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onRamp('shape', ($event.target as HTMLSelectElement).value)">
              <option value="circle">Circle</option><option value="ellipse">Ellipse</option>
            </select>
          </BindableRow>
        </template>
        <template v-if="isConic">
          <StudioSlider label="Sweep" :min="20" :max="360" :step="1" :default="360"
            :model-value="layer.ramp?.sweep ?? 360"
            :bound="boundColumnFor('layer.ramp.sweep')"
            @update:model-value="(v: number) => onRamp('sweep', v)"
            @promote="promote({ key: 'layer.ramp.sweep', label: 'Sweep', kind: 'slider', min: 20, max: 360, step: 1 }, layer.ramp?.sweep ?? 360)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.ramp.sweep', label: 'Sweep', kind: 'slider', min: 20, max: 360, step: 1 })" />
          <label class="mb-2 flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" class="h-3.5 w-3.5 accent-white/70" :checked="layer.ramp?.closeLoop ?? false" @change="onRamp('closeLoop', ($event.target as HTMLInputElement).checked)" />
            <span>Close loop</span>
          </label>
        </template>
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
        <!-- Gradient direction (u_gradHoriz) and Mapping (u_mapping) are read ONLY by
             linear/radial/orbit in the shader (the grad = gradHoriz?… and mapping<0.5?…
             branches). STACK derives its axis from ring rotation (rotStep/pivot) and never
             reads either uniform, so it's excluded here even though it's "banded". Simple
             primitives / curve / liquid / mesh don't read them either. -->
        <template v-if="isBanded && !isStack">
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
        </template>
        <template v-if="!isMesh">
          <StudioSlider label="Posterize steps" :min="0" :max="24" :step="1" :default="0"
            :model-value="layer.color.steps"
            :bound="boundColumnFor('layer.color.steps')"
            @update:model-value="(v: number) => { layer.color.steps = v; onEdit('layer.color.steps', v) }"
            @promote="promote({ key: 'layer.color.steps', label: 'Posterize steps', kind: 'slider', min: 0, max: 24, step: 1 }, layer.color.steps)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.color.steps', label: 'Posterize steps', kind: 'slider', min: 0, max: 24, step: 1 })" />
        </template>
        <!-- Hue drift (u_hueDrift) is read by the simple-primitive/curve branch (t±drift),
             linear, and radial/orbit — but NOT by stack or liquid (their branches never
             reference u_hueDrift). Posterize steps above IS read by every non-mesh branch,
             so it stays !isMesh. -->
        <template v-if="!isMesh && !isStack && !isLiquid">
          <StudioSlider label="Hue drift" :min="-180" :max="180" :step="1" :default="0"
            :model-value="layer.color.hueDrift"
            :bound="boundColumnFor('layer.color.hueDrift')"
            @update:model-value="(v: number) => { layer.color.hueDrift = v; onEdit('layer.color.hueDrift', v) }"
            @promote="promote({ key: 'layer.color.hueDrift', label: 'Hue drift', kind: 'slider', min: -180, max: 180, step: 1 }, layer.color.hueDrift)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.color.hueDrift', label: 'Hue drift', kind: 'slider', min: -180, max: 180, step: 1 })" />
        </template>
        <StudioSlider label="Hue rotate" :min="0" :max="360" :step="1" :default="0"
          :model-value="layer.color.hueRotate"
          :bound="boundColumnFor('layer.color.hueRotate')"
          @update:model-value="(v: number) => { layer.color.hueRotate = v; onEdit('layer.color.hueRotate', v) }"
          @promote="promote({ key: 'layer.color.hueRotate', label: 'Hue rotate', kind: 'slider', min: 0, max: 360, step: 1 }, layer.color.hueRotate)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.color.hueRotate', label: 'Hue rotate', kind: 'slider', min: 0, max: 360, step: 1 })" />
        <!-- Repeat — the three simple primitives and curve read u_repeat in the shader; on
             the other legacy layouts (linear/radial/orbit/stack/liquid/mesh) it's a no-op,
             so gate it behind isSimpleRamp || isCurve. Falloff stays universal below: it's baked
             into buildRampLut, which every layout's ramp goes through. -->
        <template v-if="isSimpleRamp || isCurve">
          <BindableRow control-key="layer.color.repeat" label="Repeat" kind="select" :options="['once', 'mirror', 'tile']" :bound="boundColumnFor('layer.color.repeat')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 block text-xs text-white/60">Repeat</label>
            <select :value="layer.color.repeat ?? 'once'" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onColor('repeat', ($event.target as HTMLSelectElement).value)">
              <option value="once">Once</option><option value="mirror">Mirror</option><option value="tile">Tile</option>
            </select>
          </BindableRow>
          <template v-if="(layer.color.repeat ?? 'once') === 'tile'">
            <StudioSlider label="Repeat count" :min="2" :max="16" :step="1" :default="4"
              :model-value="layer.color.repeatCount ?? 4"
              :bound="boundColumnFor('layer.color.repeatCount')"
              @update:model-value="(v: number) => onColor('repeatCount', v)"
              @promote="promote({ key: 'layer.color.repeatCount', label: 'Repeat count', kind: 'slider', min: 2, max: 16, step: 1 }, layer.color.repeatCount ?? 4)"
              @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.color.repeatCount', label: 'Repeat count', kind: 'slider', min: 2, max: 16, step: 1 })" />
          </template>
        </template>
        <!-- Falloff shapes the ramp LUT (buildRampLut), sampled via sampleRamp/sampleAlpha.
             Mesh colours come from meshColorAt (per-point literal colours) and never sample
             the ramp, so Falloff is a no-op there. Every other layout samples the ramp. -->
        <template v-if="!isMesh">
          <BindableRow control-key="layer.color.falloff" label="Falloff" kind="select" :options="['linear', 'ease', 'smooth']" :bound="boundColumnFor('layer.color.falloff')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 block text-xs text-white/60">Falloff</label>
            <select :value="layer.color.falloff ?? 'linear'" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onColor('falloff', ($event.target as HTMLSelectElement).value)">
              <option value="linear">Linear</option><option value="ease">Ease</option><option value="smooth">Smooth</option>
            </select>
          </BindableRow>
        </template>
      </StudioSection>

      <!-- Curve — the `curve` layout's parametric bezier axis. Start/End/Curvature
           are also draggable directly on the preview (CurveHandleEditor, mounted
           over the canvas above) — the sliders here are the precise/bindable twin
           of those same dials, matching the layer.curve.* ControlSpecs (controls.ts). -->
      <StudioSection v-show="onDesign && isCurve" title="Curve" :open="true">
        <BindableRow control-key="layer.curve.mode" label="Mode" kind="select" :options="['along', 'outward']" :bound="boundColumnFor('layer.curve.mode')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 block text-xs text-white/60">Mode</label>
          <select :value="layer.curve?.mode ?? CURVE_DEFAULTS.mode" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onCurve('layer.curve.mode', ($event.target as HTMLSelectElement).value)">
            <option value="along">Along</option><option value="outward">Outward</option>
          </select>
        </BindableRow>
        <BindableRow control-key="layer.curve.shape" label="Shape" kind="select" :options="['line', 'arc', 's-curve', 'wave', 'loop']" :bound="boundColumnFor('layer.curve.shape')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 block text-xs text-white/60">Shape</label>
          <select :value="layer.curve?.shape ?? CURVE_DEFAULTS.shape" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="onCurve('layer.curve.shape', ($event.target as HTMLSelectElement).value)">
            <option value="line">Line</option><option value="arc">Arc</option><option value="s-curve">S-curve</option><option value="wave">Wave</option><option value="loop">Loop</option>
          </select>
        </BindableRow>
        <StudioSlider label="Start X" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.start.x"
          :model-value="layer.curve?.start.x ?? CURVE_DEFAULTS.start.x"
          :bound="boundColumnFor('layer.curve.start.x')"
          @update:model-value="(v: number) => onCurve('layer.curve.start.x', v)"
          @promote="promote({ key: 'layer.curve.start.x', label: 'Start X', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.start.x ?? CURVE_DEFAULTS.start.x)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.start.x', label: 'Start X', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        <StudioSlider label="Start Y" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.start.y"
          :model-value="layer.curve?.start.y ?? CURVE_DEFAULTS.start.y"
          :bound="boundColumnFor('layer.curve.start.y')"
          @update:model-value="(v: number) => onCurve('layer.curve.start.y', v)"
          @promote="promote({ key: 'layer.curve.start.y', label: 'Start Y', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.start.y ?? CURVE_DEFAULTS.start.y)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.start.y', label: 'Start Y', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        <StudioSlider label="End X" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.end.x"
          :model-value="layer.curve?.end.x ?? CURVE_DEFAULTS.end.x"
          :bound="boundColumnFor('layer.curve.end.x')"
          @update:model-value="(v: number) => onCurve('layer.curve.end.x', v)"
          @promote="promote({ key: 'layer.curve.end.x', label: 'End X', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.end.x ?? CURVE_DEFAULTS.end.x)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.end.x', label: 'End X', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        <StudioSlider label="End Y" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.end.y"
          :model-value="layer.curve?.end.y ?? CURVE_DEFAULTS.end.y"
          :bound="boundColumnFor('layer.curve.end.y')"
          @update:model-value="(v: number) => onCurve('layer.curve.end.y', v)"
          @promote="promote({ key: 'layer.curve.end.y', label: 'End Y', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.end.y ?? CURVE_DEFAULTS.end.y)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.end.y', label: 'End Y', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        <template v-if="(layer.curve?.shape ?? CURVE_DEFAULTS.shape) !== 'line'">
          <StudioSlider label="Curvature" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.curvature"
            :model-value="layer.curve?.curvature ?? CURVE_DEFAULTS.curvature"
            :bound="boundColumnFor('layer.curve.curvature')"
            @update:model-value="(v: number) => onCurve('layer.curve.curvature', v)"
            @promote="promote({ key: 'layer.curve.curvature', label: 'Curvature', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.curvature ?? CURVE_DEFAULTS.curvature)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.curvature', label: 'Curvature', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
          <StudioSlider label="Bend" :min="-1" :max="1" :step="0.01" :default="CURVE_DEFAULTS.bend"
            :model-value="layer.curve?.bend ?? CURVE_DEFAULTS.bend"
            :bound="boundColumnFor('layer.curve.bend')"
            @update:model-value="(v: number) => onCurve('layer.curve.bend', v)"
            @promote="promote({ key: 'layer.curve.bend', label: 'Bend', kind: 'slider', min: -1, max: 1, step: 0.01 }, layer.curve?.bend ?? CURVE_DEFAULTS.bend)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.bend', label: 'Bend', kind: 'slider', min: -1, max: 1, step: 0.01 })" />
        </template>
        <template v-if="(layer.curve?.shape ?? CURVE_DEFAULTS.shape) === 'wave'">
          <StudioSlider label="Waves" :min="1" :max="8" :step="1" :default="CURVE_DEFAULTS.waves"
            :model-value="layer.curve?.waves ?? CURVE_DEFAULTS.waves"
            :bound="boundColumnFor('layer.curve.waves')"
            @update:model-value="(v: number) => onCurve('layer.curve.waves', v)"
            @promote="promote({ key: 'layer.curve.waves', label: 'Waves', kind: 'slider', min: 1, max: 8, step: 1 }, layer.curve?.waves ?? CURVE_DEFAULTS.waves)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.waves', label: 'Waves', kind: 'slider', min: 1, max: 8, step: 1 })" />
          <StudioSlider label="Phase" :min="0" :max="1" :step="0.01" :default="CURVE_DEFAULTS.phase"
            :model-value="layer.curve?.phase ?? CURVE_DEFAULTS.phase"
            :bound="boundColumnFor('layer.curve.phase')"
            @update:model-value="(v: number) => onCurve('layer.curve.phase', v)"
            @promote="promote({ key: 'layer.curve.phase', label: 'Phase', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.curve?.phase ?? CURVE_DEFAULTS.phase)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.phase', label: 'Phase', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        </template>
        <template v-if="(layer.curve?.mode ?? CURVE_DEFAULTS.mode) === 'outward'">
          <StudioSlider label="Width" :min="0.02" :max="1" :step="0.01" :default="CURVE_DEFAULTS.width"
            :model-value="layer.curve?.width ?? CURVE_DEFAULTS.width"
            :bound="boundColumnFor('layer.curve.width')"
            @update:model-value="(v: number) => onCurve('layer.curve.width', v)"
            @promote="promote({ key: 'layer.curve.width', label: 'Width', kind: 'slider', min: 0.02, max: 1, step: 0.01 }, layer.curve?.width ?? CURVE_DEFAULTS.width)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.curve.width', label: 'Width', kind: 'slider', min: 0.02, max: 1, step: 0.01 })" />
        </template>
      </StudioSection>

      <!-- Flow (domain warp — distorts every layout; the heart of the liquid look) -->
      <StudioSection v-show="onDesign" title="Flow" badge="all layouts" :open="isLiquid || isMesh">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Warps the gradient into liquid swirls. At 0 intensity the gradient is undistorted.</p>
        <StudioSlider label="Flow angle" :min="0" :max="360" :step="1"
          :model-value="config.flow!.angle"
          :bound="boundColumnFor('flow.angle')"
          @update:model-value="(v: number) => { config.flow!.angle = v; onEdit('flow.angle', v) }"
          @promote="promote({ key: 'flow.angle', label: 'Flow angle', kind: 'slider', min: 0, max: 360, step: 1 }, config.flow!.angle)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.angle', label: 'Flow angle', kind: 'slider', min: 0, max: 360, step: 1 })" />
        <StudioSlider label="Noise scale" :min="0.5" :max="8" :step="0.1"
          :model-value="config.flow!.noiseScale"
          :bound="boundColumnFor('flow.noiseScale')"
          @update:model-value="(v: number) => { config.flow!.noiseScale = v; onEdit('flow.noiseScale', v) }"
          @promote="promote({ key: 'flow.noiseScale', label: 'Noise scale', kind: 'slider', min: 0.5, max: 8, step: 0.1 }, config.flow!.noiseScale)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.noiseScale', label: 'Noise scale', kind: 'slider', min: 0.5, max: 8, step: 0.1 })" />
        <StudioSlider label="Noise intensity" :min="0" :max="100" :step="1"
          :model-value="config.flow!.intensity"
          :bound="boundColumnFor('flow.intensity')"
          @update:model-value="(v: number) => { config.flow!.intensity = v; onEdit('flow.intensity', v) }"
          @promote="promote({ key: 'flow.intensity', label: 'Noise intensity', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.intensity)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.intensity', label: 'Noise intensity', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Curve distortion" :min="0" :max="100" :step="1"
          :model-value="config.flow!.distortion"
          :bound="boundColumnFor('flow.distortion')"
          @update:model-value="(v: number) => { config.flow!.distortion = v; onEdit('flow.distortion', v) }"
          @promote="promote({ key: 'flow.distortion', label: 'Curve distortion', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.distortion)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.distortion', label: 'Curve distortion', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Detail" :min="1" :max="6" :step="1"
          :model-value="config.flow!.detail"
          :bound="boundColumnFor('flow.detail')"
          @update:model-value="(v: number) => { config.flow!.detail = v; onEdit('flow.detail', v) }"
          @promote="promote({ key: 'flow.detail', label: 'Detail', kind: 'slider', min: 1, max: 6, step: 1 }, config.flow!.detail)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.detail', label: 'Detail', kind: 'slider', min: 1, max: 6, step: 1 })" />
        <StudioSlider label="Swirl" :min="0" :max="100" :step="1"
          :model-value="flowSwirl"
          :bound="boundColumnFor('flow.swirl')"
          @update:model-value="(v: number) => { flowSwirl = v; onEdit('flow.swirl', v) }"
          @promote="promote({ key: 'flow.swirl', label: 'Swirl', kind: 'slider', min: 0, max: 100, step: 1 }, flowSwirl)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.swirl', label: 'Swirl', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Flow speed" :min="0" :max="100" :step="1"
          :model-value="flowSpeed"
          :bound="boundColumnFor('flow.speed')"
          @update:model-value="(v: number) => { flowSpeed = v; onEdit('flow.speed', v) }"
          @promote="promote({ key: 'flow.speed', label: 'Flow speed', kind: 'slider', min: 0, max: 100, step: 1 }, flowSpeed)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.speed', label: 'Flow speed', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <p class="mt-1 text-[10px] leading-snug text-white/30">Living drift — the warp flows over the loop. Export as video to capture the motion.</p>
      </StudioSection>

      <!-- Depth & Light (liquid fold shading only) -->
      <StudioSection v-show="onDesign" v-if="isLiquid" title="Depth & light" badge="liquid">
        <label class="mb-1 block text-xs text-white/60">Presets</label>
        <div class="mb-3 grid grid-cols-3 gap-1">
          <button v-for="p in LIQUID_PRESETS" :key="p" class="rounded bg-white/[0.04] px-1 py-1 text-[11px] capitalize text-white/60 transition hover:bg-white/10 hover:text-white"
                  @click="applyLiquidPreset(p)">{{ p }}</button>
        </div>
        <StudioSlider label="Depth" :min="0" :max="100" :step="1"
          :model-value="config.flow!.depth"
          :bound="boundColumnFor('flow.depth')"
          @update:model-value="(v: number) => { config.flow!.depth = v; onEdit('flow.depth', v) }"
          @promote="promote({ key: 'flow.depth', label: 'Depth', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.depth)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.depth', label: 'Depth', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <!-- Highlights / Shadows / Gloss / Ripple are applied only under u_layout[0] (see
             baseLiquid): they light the BASE liquid layer's emboss, not per-layer. Shown
             inert when a non-base layer is liquid but layer 0 isn't. -->
        <template v-if="baseLiquid">
          <StudioSlider label="Highlights" :min="0" :max="100" :step="1"
            :model-value="config.flow!.highlights"
            :bound="boundColumnFor('flow.highlights')"
            @update:model-value="(v: number) => { config.flow!.highlights = v; onEdit('flow.highlights', v) }"
            @promote="promote({ key: 'flow.highlights', label: 'Highlights', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.highlights)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.highlights', label: 'Highlights', kind: 'slider', min: 0, max: 100, step: 1 })" />
          <StudioSlider label="Shadows" :min="0" :max="100" :step="1"
            :model-value="config.flow!.shadows"
            :bound="boundColumnFor('flow.shadows')"
            @update:model-value="(v: number) => { config.flow!.shadows = v; onEdit('flow.shadows', v) }"
            @promote="promote({ key: 'flow.shadows', label: 'Shadows', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.shadows)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.shadows', label: 'Shadows', kind: 'slider', min: 0, max: 100, step: 1 })" />
        </template>
        <StudioSlider label="Fold scale" :min="0" :max="100" :step="1"
          :model-value="config.flow!.foldScale"
          :bound="boundColumnFor('flow.foldScale')"
          @update:model-value="(v: number) => { config.flow!.foldScale = v; onEdit('flow.foldScale', v) }"
          @promote="promote({ key: 'flow.foldScale', label: 'Fold scale', kind: 'slider', min: 0, max: 100, step: 1 }, config.flow!.foldScale)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.foldScale', label: 'Fold scale', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <template v-if="baseLiquid">
          <StudioSlider label="Gloss" :min="0" :max="100" :step="1"
            :model-value="flowGloss"
            :bound="boundColumnFor('flow.gloss')"
            @update:model-value="(v: number) => { flowGloss = v; onEdit('flow.gloss', v) }"
            @promote="promote({ key: 'flow.gloss', label: 'Gloss', kind: 'slider', min: 0, max: 100, step: 1 }, flowGloss)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.gloss', label: 'Gloss', kind: 'slider', min: 0, max: 100, step: 1 })" />
        </template>
      </StudioSection>

      <!-- Liquid surface (turns the smoky warp into flowing fluid) -->
      <StudioSection v-show="onDesign" v-if="isLiquid" title="Liquid surface" badge="liquid" :open="true">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Push the smoky warp toward real fluid — marbled veins, a wet rippling skin, glassy refraction, and viscosity.</p>
        <StudioSlider label="Veins" :min="0" :max="100" :step="1"
          :model-value="flowVeins"
          :bound="boundColumnFor('flow.veins')"
          @update:model-value="(v: number) => { flowVeins = v; onEdit('flow.veins', v) }"
          @promote="promote({ key: 'flow.veins', label: 'Veins', kind: 'slider', min: 0, max: 100, step: 1 }, flowVeins)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.veins', label: 'Veins', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Vein scale" :min="0" :max="100" :step="1"
          :model-value="flowVeinScale"
          :bound="boundColumnFor('flow.veinScale')"
          @update:model-value="(v: number) => { flowVeinScale = v; onEdit('flow.veinScale', v) }"
          @promote="promote({ key: 'flow.veinScale', label: 'Vein scale', kind: 'slider', min: 0, max: 100, step: 1 }, flowVeinScale)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.veinScale', label: 'Vein scale', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <template v-if="baseLiquid">
          <StudioSlider label="Ripple" :min="0" :max="100" :step="1"
            :model-value="flowRipple"
            :bound="boundColumnFor('flow.ripple')"
            @update:model-value="(v: number) => { flowRipple = v; onEdit('flow.ripple', v) }"
            @promote="promote({ key: 'flow.ripple', label: 'Ripple', kind: 'slider', min: 0, max: 100, step: 1 }, flowRipple)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.ripple', label: 'Ripple', kind: 'slider', min: 0, max: 100, step: 1 })" />
        </template>
        <StudioSlider label="Refraction" :min="0" :max="100" :step="1"
          :model-value="flowRefract"
          :bound="boundColumnFor('flow.refract')"
          @update:model-value="(v: number) => { flowRefract = v; onEdit('flow.refract', v) }"
          @promote="promote({ key: 'flow.refract', label: 'Refraction', kind: 'slider', min: 0, max: 100, step: 1 }, flowRefract)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.refract', label: 'Refraction', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Viscosity" :min="0" :max="100" :step="1"
          :model-value="flowViscosity"
          :bound="boundColumnFor('flow.viscosity')"
          @update:model-value="(v: number) => { flowViscosity = v; onEdit('flow.viscosity', v) }"
          @promote="promote({ key: 'flow.viscosity', label: 'Viscosity', kind: 'slider', min: 0, max: 100, step: 1 }, flowViscosity)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'flow.viscosity', label: 'Viscosity', kind: 'slider', min: 0, max: 100, step: 1 })" />
      </StudioSection>

      <!-- Mesh (soft point-mesh gradient) -->
      <StudioSection v-show="onDesign" v-if="isMesh" title="Mesh" badge="layer 1" :open="true">
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
        <StudioSlider label="Softness" :min="10" :max="100" :step="1"
          :model-value="mesh.softness"
          :bound="boundColumnFor('layer.mesh.softness')"
          @update:model-value="(v: number) => { mesh.softness = v; onEdit('layer.mesh.softness', v) }"
          @promote="promote({ key: 'layer.mesh.softness', label: 'Softness', kind: 'slider', min: 10, max: 100, step: 1 }, mesh.softness)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.mesh.softness', label: 'Softness', kind: 'slider', min: 10, max: 100, step: 1 })" />
        <StudioSlider label="Contrast" :min="0" :max="100" :step="1"
          :model-value="mesh.contrast"
          :bound="boundColumnFor('layer.mesh.contrast')"
          @update:model-value="(v: number) => { mesh.contrast = v; onEdit('layer.mesh.contrast', v) }"
          @promote="promote({ key: 'layer.mesh.contrast', label: 'Contrast', kind: 'slider', min: 0, max: 100, step: 1 }, mesh.contrast)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.mesh.contrast', label: 'Contrast', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Blur" :min="0" :max="100" :step="1"
          :model-value="meshBlur"
          :bound="boundColumnFor('layer.mesh.blur')"
          @update:model-value="(v: number) => { meshBlur = v; onEdit('layer.mesh.blur', v) }"
          @promote="promote({ key: 'layer.mesh.blur', label: 'Blur', kind: 'slider', min: 0, max: 100, step: 1 }, meshBlur)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.mesh.blur', label: 'Blur', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <StudioSlider label="Drift" :min="0" :max="100" :step="1"
          :model-value="mesh.drift"
          :bound="boundColumnFor('layer.mesh.drift')"
          @update:model-value="(v: number) => { mesh.drift = v; onEdit('layer.mesh.drift', v) }"
          @promote="promote({ key: 'layer.mesh.drift', label: 'Drift', kind: 'slider', min: 0, max: 100, step: 1 }, mesh.drift)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.mesh.drift', label: 'Drift', kind: 'slider', min: 0, max: 100, step: 1 })" />
      </StudioSection>

      <!-- Relief. Only shades the band/ring HEIGHT field (linear/radial/orbit/stack);
           liquid uses flow.depth and mesh has no relief, so this whole section is
           hidden for those layouts. Grain moved to the shared post stack's own Grain
           section (Task 8) — see the schema-driven post panel further down. -->
      <StudioSection v-show="onDesign && baseBanded" title="Relief" :open="false">
        <StudioSlider label="Relief" :min="0" :max="1" :step="0.01"
          :model-value="config.relief.relief"
          :bound="boundColumnFor('relief.relief')"
          @update:model-value="(v: number) => { config.relief.relief = v; onEdit('relief.relief', v) }"
          @promote="promote({ key: 'relief.relief', label: 'Relief', kind: 'slider', min: 0, max: 1, step: 0.01 }, config.relief.relief)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'relief.relief', label: 'Relief', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        <StudioSlider label="Light angle" :min="0" :max="360" :step="1"
          :model-value="lightAz"
          :bound="boundColumnFor('relief.light.azimuth')"
          @update:model-value="(v: number) => { lightAz = v; onEdit('relief.light.azimuth', v) }"
          @promote="promote({ key: 'relief.light.azimuth', label: 'Light angle', kind: 'slider', min: 0, max: 360, step: 1 }, lightAz)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'relief.light.azimuth', label: 'Light angle', kind: 'slider', min: 0, max: 360, step: 1 })" />
        <StudioSlider label="Light height" :min="0" :max="90" :step="1"
          :model-value="lightEl"
          :bound="boundColumnFor('relief.light.elevation')"
          @update:model-value="(v: number) => { lightEl = v; onEdit('relief.light.elevation', v) }"
          @promote="promote({ key: 'relief.light.elevation', label: 'Light height', kind: 'slider', min: 0, max: 90, step: 1 }, lightEl)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'relief.light.elevation', label: 'Light height', kind: 'slider', min: 0, max: 90, step: 1 })" />
      </StudioSection>

      <!-- Focus / soft-focus DoF -->
      <StudioSection v-show="onDesign" v-if="config.focus" title="Focus" badge="both layers" :open="false">
        <StudioSlider label="Blur" :min="0" :max="100" :step="1"
          :model-value="config.focus.blur"
          :bound="boundColumnFor('focus.blur')"
          @update:model-value="(v: number) => { config.focus.blur = v; onEdit('focus.blur', v) }"
          @promote="promote({ key: 'focus.blur', label: 'Blur', kind: 'slider', min: 0, max: 100, step: 1 }, config.focus.blur)"
          @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.blur', label: 'Blur', kind: 'slider', min: 0, max: 100, step: 1 })" />
        <BindableRow control-key="focus.shape" label="Focus region" kind="select" :options="['off', 'radial', 'linear']" :bound="boundColumnFor('focus.shape')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
          <label class="mb-1 block text-xs text-white/60">Focus region</label>
          <select v-model="config.focus.shape" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize" @change="onEdit('focus.shape', config.focus.shape)">
            <option value="off">Off — blur everything</option>
            <option value="radial">Radial — sharp spot</option>
            <option value="linear">Linear — tilt-shift band</option>
          </select>
        </BindableRow>
        <template v-if="config.focus.shape !== 'off'">
          <StudioSlider label="Focus size" :min="0" :max="1" :step="0.01"
            :model-value="config.focus.radius"
            :bound="boundColumnFor('focus.radius')"
            @update:model-value="(v: number) => { config.focus.radius = v; onEdit('focus.radius', v) }"
            @promote="promote({ key: 'focus.radius', label: 'Focus size', kind: 'slider', min: 0, max: 1, step: 0.01 }, config.focus.radius)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.radius', label: 'Focus size', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
          <StudioSlider label="Focus falloff" :min="0" :max="100" :step="1"
            :model-value="config.focus.softness"
            :bound="boundColumnFor('focus.softness')"
            @update:model-value="(v: number) => { config.focus.softness = v; onEdit('focus.softness', v) }"
            @promote="promote({ key: 'focus.softness', label: 'Focus falloff', kind: 'slider', min: 0, max: 100, step: 1 }, config.focus.softness)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.softness', label: 'Focus falloff', kind: 'slider', min: 0, max: 100, step: 1 })" />
          <StudioSlider label="Focus X" :min="-0.5" :max="0.5" :step="0.01"
            :model-value="config.focus.x"
            :bound="boundColumnFor('focus.x')"
            @update:model-value="(v: number) => { config.focus.x = v; onEdit('focus.x', v) }"
            @promote="promote({ key: 'focus.x', label: 'Focus X', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 }, config.focus.x)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.x', label: 'Focus X', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 })" />
          <StudioSlider label="Focus Y" :min="-0.5" :max="0.5" :step="0.01"
            :model-value="config.focus.y"
            :bound="boundColumnFor('focus.y')"
            @update:model-value="(v: number) => { config.focus.y = v; onEdit('focus.y', v) }"
            @promote="promote({ key: 'focus.y', label: 'Focus Y', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 }, config.focus.y)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.y', label: 'Focus Y', kind: 'slider', min: -0.5, max: 0.5, step: 0.01 })" />
          <template v-if="config.focus.shape === 'linear'">
            <StudioSlider label="Band angle" :min="0" :max="360" :step="1"
              :model-value="config.focus.angle"
              :bound="boundColumnFor('focus.angle')"
              @update:model-value="(v: number) => { config.focus.angle = v; onEdit('focus.angle', v) }"
              @promote="promote({ key: 'focus.angle', label: 'Band angle', kind: 'slider', min: 0, max: 360, step: 1 }, config.focus.angle)"
              @menu="(e: MouseEvent) => openVarMenu(e, { key: 'focus.angle', label: 'Band angle', kind: 'slider', min: 0, max: 360, step: 1 })" />
          </template>
        </template>
      </StudioSection>

      <!-- Layer (blend/opacity for the active non-base layer; add/remove/reorder/select
           now live in the aside StudioLayerStack) -->
      <StudioSection v-show="onDesign" title="Layer" :open="false">
        <template v-if="activeLayer > 0">
          <BindableRow control-key="layer.blend" label="Blend" kind="select" :options="[...BLEND_MODES]" :bound="boundColumnFor('layer.blend')" @menu="openVarMenu" @promote="(control) => promote(control, paramsProxy[control.key] as string | number)">
            <label class="mb-1 block text-xs text-white/60">Blend</label>
            <select v-model="layer.blend" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize" @change="onEdit('layer.blend', layer.blend)">
              <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
            </select>
          </BindableRow>
          <StudioSlider label="Opacity" :min="0" :max="1" :step="0.01"
            :model-value="layer.opacity"
            :bound="boundColumnFor('layer.opacity')"
            @update:model-value="(v: number) => { layer.opacity = v; onEdit('layer.opacity', v) }"
            @promote="promote({ key: 'layer.opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01 }, layer.opacity)"
            @menu="(e: MouseEvent) => openVarMenu(e, { key: 'layer.opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1, step: 0.01 })" />
        </template>
      </StudioSection>

      <!-- Shape -->
      <StudioSection v-show="onDesign" v-if="isBanded" title="Shape" :badge="layerNames[activeLayer] ?? `Layer ${activeLayer + 1}`">
        <div v-if="!isStack" class="mb-2 grid grid-cols-4 gap-1">
          <button v-for="s in SHAPE_KINDS" :key="s" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.type === s ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setShape(s)">{{ s }}</button>
        </div>
        <StudioSlider :label="isStack ? 'Ring count' : 'Count'" :min="2" :max="isStack ? 40 : 64" :step="1" :bindable="false"
          :model-value="layer.shape.count"
          @update:model-value="(v: number) => { layer.shape.count = v }" />
        <template v-if="isStack">
          <StudioSlider label="Rotation / ring" :min="0" :max="45" :step="1" :default="8" :bindable="false"
            :model-value="layer.shape.rotStep ?? 8"
            @update:model-value="(v: number) => { layer.shape.rotStep = v }" />
          <StudioSlider label="Pivot" :min="0" :max="0.6" :step="0.01" :default="0.1" :bindable="false"
            :model-value="layer.shape.pivot ?? 0.1"
            @update:model-value="(v: number) => { layer.shape.pivot = v }" />
          <StudioSlider label="Disc size" :min="1" :max="2.2" :step="0.02" :default="1" :bindable="false"
            :model-value="layer.shape.ringScale ?? 1"
            @update:model-value="(v: number) => { layer.shape.ringScale = v }" />
          <label class="mb-1 block text-xs text-white/60">Ring shape</label>
          <div class="grid grid-cols-3 gap-1">
            <button v-for="rs in RING_SHAPES" :key="rs" class="rounded px-1 py-1 text-[11px] capitalize transition"
                    :class="(layer.shape.ringShape ?? 'circle') === rs ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.shape.ringShape = rs">{{ rs }}</button>
          </div>
        </template>
        <template v-if="!isStack">
        <template v-if="layer.shape.type === 'wave' || layer.shape.type === 'bands'">
          <StudioSlider label="Peaks" :min="1" :max="12" :step="1" :bindable="false"
            :model-value="layer.shape.peaks"
            @update:model-value="(v: number) => { layer.shape.peaks = v }" />
          <StudioSlider label="Wave phase" :min="0" :max="1" :step="0.01" :bindable="false"
            :model-value="layer.shape.phase"
            @update:model-value="(v: number) => { layer.shape.phase = v }" />
        </template>
        <template v-else-if="layer.shape.type === 'noise'">
          <StudioSlider label="Detail" :min="1" :max="8" :step="1" :bindable="false"
            :model-value="layer.shape.detail"
            @update:model-value="(v: number) => { layer.shape.detail = v }" />
          <StudioSlider label="Scrub" :min="0" :max="1" :step="0.01" :bindable="false"
            :model-value="layer.shape.scrub"
            @update:model-value="(v: number) => { layer.shape.scrub = v }" />
        </template>
        <template v-else>
          <StudioSlider label="Valley position" :min="0" :max="1" :step="0.01" :bindable="false"
            :model-value="layer.shape.valley"
            @update:model-value="(v: number) => { layer.shape.valley = v }" />
        </template>
        <StudioSlider label="Min depth" :min="0" :max="1" :step="0.01" :bindable="false"
          :model-value="layer.shape.minDepth"
          @update:model-value="(v: number) => { layer.shape.minDepth = v }" />
        <StudioSlider label="Curve exponent" :min="0.2" :max="3" :step="0.05" :bindable="false"
          :model-value="layer.shape.curveExp"
          @update:model-value="(v: number) => { layer.shape.curveExp = v }" />
        <StudioSlider :label="layer.shape.type === 'bands' ? 'Randomness' : 'Jitter'" :min="0" :max="1" :step="0.01" :bindable="false"
          :model-value="layer.shape.jitter"
          @update:model-value="(v: number) => { layer.shape.jitter = v }" />
        <StudioSlider label="Gap" :min="0" :max="0.8" :step="0.01" :bindable="false"
          :model-value="layer.shape.gap"
          @update:model-value="(v: number) => { layer.shape.gap = v }" />
        <StudioSlider label="Rounding" :min="0" :max="1" :step="0.01" :bindable="false"
          :model-value="layer.shape.rounding"
          @update:model-value="(v: number) => { layer.shape.rounding = v }" />
        <template v-if="isRadial">
          <StudioSlider label="Sweep" :min="20" :max="360" :step="1" :bindable="false"
            :model-value="layer.shape.sweep"
            @update:model-value="(v: number) => { layer.shape.sweep = v }" />
          <StudioSlider label="Scrub / rotate" :min="0" :max="1" :step="0.01" :bindable="false"
            :model-value="layer.shape.scrub"
            @update:model-value="(v: number) => { layer.shape.scrub = v }" />
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

      <!-- Motion -->
      <StudioSection v-show="onMotion" title="Motion" :open="onMotion">
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
            <StudioSlider label="Duration" :min="1" :max="12" :step="0.5" :bindable="false"
              :model-value="config.motion.duration"
              @update:model-value="(v: number) => { config.motion.duration = v }" />
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

      <!-- Post (shared stack): Bloom/Color/Duotone/Chroma/Blur/Film/Halftone/Dot screen/
           Glitch/Grain/Vignette, one collapsible card per effect. Schema-driven — see
           setPostControl above; POST_SECTIONS is the allow-list groupIntoSections() uses
           to pick post.* controls out of the full GRADIENT_CONTROLS array. -->
      <StudioControlPanel
        v-show="onDesign"
        :controls="GRADIENT_CONTROLS"
        :order="POST_SECTIONS"
        :value="(k: string) => paramsProxy[k] as string | number | boolean"
        :visible="postControlVisible"
        :bound-for="boundColumnFor"
        :go-to-collection="goToCollection"
        @set="setPostControl"
        @promote="promotePostControl"
        @menu="(e: MouseEvent, c: ControlSpec) => openVarMenu(e, c)"
      />

      <!-- Export -->
      <StudioSection v-show="onDesign" title="Export" :open="false">
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
