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
import { configHasShaderFill } from '~/lib/shapefx/surface'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'
import { DEFAULT_CONFIG, mergeConfig, type ShapeConfig } from '~/lib/shapefx/config'
import { reroll } from '~/lib/shapefx/randomize'
import { paletteFor } from '~/lib/shapefx/color'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { HARMONY_TYPES, HARMONY_LABELS, toStops } from '~/lib/color/harmony'
import { hexToOklch, oklchToHex } from '~/lib/color/convert'
import { DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'
import type { ControlSpec } from '~/lib/spacetype/effect'
import ShaderFillEditor from '~/components/vue-canvas/widgets/ShaderFillEditor.vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioActionsFooter from '~/components/vue-canvas/studio/StudioActionsFooter.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioColorField from '~/components/vue-canvas/studio/StudioColorField.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
import CanvasContextMenu from '~/components/vue-canvas/CanvasContextMenu.vue'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { useStudioVarMenu } from '~/composables/useStudioVarMenu'
import { makeConfigParams } from '~/lib/agent/configParams'
import { shapeAgentControls, SHAPE_GUIDANCE } from '~/lib/shapefx/agentControls'
import { SHAPE_CONTROLS, SHAPE_SECTIONS, type ShapeControl } from '~/lib/shapefx/controls'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { showIfVisible } from '~/lib/studio/sections'
import { useStudioAutosave } from '~/lib/studio/autosave'
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'

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

// Sticky footer status (StudioActionsFooter): real Saving…/Saved ✓ driven by
// useStudioAutosave, debounced off `config` — same recipe as GradientStudioSurface.
// Watch everything saveConfig persists EXCEPT orbit — orbit is camera state that
// mutates continuously during a drag, and watching it would thrash autosave (the
// Scene3D lesson). canvasW/H/aspectKey are real user edits and must autosave.
const { saving: autoSaving, saved: autoSaved } = useStudioAutosave(
  () => ({ config: config.value, canvasW: canvasW.value, canvasH: canvasH.value, aspectKey: aspectKey.value }),
  saveConfig,
)

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
const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes ?? [], edges: () => props.edges ?? [] },
)

const { wiredColumns, sweepPopover, applySweep, varMenu, openVarMenu, goToCollection } = useStudioVarMenu({
  nodeId: () => props.nodeId,
  nodes: () => props.nodes ?? [],
  edges: () => props.edges ?? [],
  liveValue: (key) => paramsProxy[key] as string | number,
  boundColumnFor, boundColumnKeyFor, promote, unbind,
})

// ── StudioControlPanel wiring — the schema (SHAPE_CONTROLS/SHAPE_SECTIONS) is now the
// single source for every slider/select/color control below except the hand-written
// blocks called out in the panel's own doc comment (harmony grid, palette preview,
// base-colour swatch, transparent-background switch, seed/re-roll/import, canvas dims).
// `setShapeControl` mirrors what every hand-written control did before the panel existed
// (write the proxy, then onEdit for write-through to a bound Collection cell) plus the one
// side effect the panel's generic setter can't know about: switching fill.type INTO
// 'shader' seeds a fresh spec (cloned — DEFAULT_SHADER_SPEC is a shared module constant,
// never mutated in place) so ShaderFillEditor has something real to bind to immediately.
// `value: string | number | boolean` — widened for the shared post stack's
// switch-kind controls (post.bloom etc.), same cast Gradient's setPostControl
// uses: paramsProxy/onEdit are typed narrower (string|number) but store/forward
// whatever they're handed at runtime; the cast documents that, it doesn't change it.
function setShapeControl(key: string, value: string | number | boolean) {
  if (key === 'fill.type' && value === 'shader' && !config.value.fill.shader) {
    config.value.fill.shader = structuredClone(DEFAULT_SHADER_SPEC)
  }
  paramsProxy[key] = value as string | number
  onEdit(key, value as string | number)
}
function promoteShapeControl(c: ControlSpec) {
  promote(c, paramsProxy[c.key] as string | number)
}
function controlVisible(c: ControlSpec): boolean {
  const sc = c as ShapeControl
  // `showIf` too, not just `when`: the shared post stack's param rows declare it so
  // they appear only once their effect's switch is on. Checking `when` alone showed
  // all 21 of them permanently.
  return (!sc.when || sc.when(config.value)) && showIfVisible(c, k => paramsProxy[k])
}
// StudioControlPanel's per-key named slots (#control-<key>) are dynamically named, so
// vue-tsc can't infer their scoped-prop type without the panel declaring `defineSlots` —
// cast through this one spot rather than annotating each `v-slot` (which the compiler
// rejects: the dynamic-name overload it resolves to expects `props: {}`).
function slotControl(slotProps: unknown): ControlSpec {
  return (slotProps as { control: ControlSpec }).control
}

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

// Grain and distortion are baked by ShapeEngine's post pass (see lib/shapefx/post.ts) —
// no CSS/SVG overlay here. The two sliders below just write into config.style, same as
// every other param.

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
// Wall-clock start of this surface's rAF loop — Shape Studio has no timeline/loop-duration of
// its own (unlike Space Type), so a shader fill's live field animates off elapsed real time
// rather than a normalised t01. Set once in onMounted, read every frame() tick.
let mountedAt = 0
// Frozen-field hint, mirroring SpaceTypeSurface.vue's frozenFieldCount exactly (same design
// rule: no silent caps on any surface). Reset to 0 whenever the config has no shader fill so
// it doesn't show a stale count after switching the fill away from shader.
const frozenFieldCount = ref(0)
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
    // Only touch the shader-fill refresh path when the CURRENT config actually has one — see
    // ShapeEngine.refreshShaderFields's doc: this isn't needed for correctness (an owner with
    // no cached fields is a cheap no-op), it's so a plain-fill Shape node's frame loop doesn't
    // start paying new per-frame cost it never paid before.
    const hasShaderFill = configHasShaderFill(config.value)
    if (hasShaderFill) engine.refreshShaderFields((performance.now() - mountedAt) / 1000)
    frozenFieldCount.value = hasShaderFill ? engine.frozenFieldCount : 0
    engine.render(orbit)
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
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
  if (!detectWebGL()) { webglOk.value = false; return }
  const { w, h } = previewDims()
  engine = new ShapeEngine(canvas.value!, w, h)
  lastW = w; lastH = h
  mountedAt = performance.now()
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
  unregisterStudioParamBaker(props.nodeId)
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
  // Important 5 (final review): unclamp a shader fill to the ACTUAL export resolution before
  // reading back — without this, the live preview's LIVE_FIELD_PX-clamped field (whatever the
  // frame loop last refreshed) just gets upscaled by the 3D render at the higher output size.
  const hasShaderFill = configHasShaderFill(config.value)
  if (hasShaderFill) {
    engine.setBake(true)
    engine.refreshShaderFields((performance.now() - mountedAt) / 1000, true, canvasW.value, canvasH.value)
  }
  try {
    const blob = await engine.frameToBlob(canvasW.value, canvasH.value)
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
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
    if (hasShaderFill) engine.setBake(false)   // restore the live-preview clamp for the resumed rAF loop
    exporting.value = false
    raf = requestAnimationFrame(frame)
  }
}

// Studio param-baker (Collection sweeps) — bakes ONE frame with a set of `params.*`
// overrides applied (one row of a collection sweep/generate run), without disturbing
// the studio's live on-screen config: snapshot the current value of every overridden
// key via the same dotted-path proxy the agent tuner/var-bindings paths use
// (`paramsProxy`), write the overrides through that same proxy (mutating the shared
// reactive `config` — identical to a user edit), render one full-res frame through a
// short-lived offscreen ShapeEngine (the same one-shot new-engine → setConfig →
// render(orbit) → frameToBlob → dispose pattern ShapeStudioNode.vue's bakeOutput
// uses for its own cascade baker, kept separate from the live preview `engine` so
// this never fights the rAF loop's render/resize), then restore the snapshot in
// `finally` regardless of success/failure — the restore is what stops a sweep from
// permanently mutating the user's config.
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  if (!detectWebGL()) return null
  const keys = Object.keys(overrides)
  const snapshot = new Map<string, string | number | undefined>()
  for (const key of keys) snapshot.set(key, paramsProxy[key] as string | number | undefined)
  let offEngine: ShapeEngine | null = null
  try {
    // Item 2 fix (final review, residual Critical): this builds a THROWAWAY offscreen
    // engine and renders exactly once per Collection sweep row — unlike the persistent
    // live-preview `engine` (which self-heals over subsequent rAF frames once field.ts's
    // own catalog fetch lands), a one-shot bake gets no second chance. Awaiting the
    // catalog before building guarantees a shader-fill effect is resolvable before
    // setConfig ever runs, instead of silently baking (and uploading) the input-fill
    // fallback with no retry.
    await fetchShaderFxCatalog().catch(() => { /* offline/backend down — proceeds and falls back same as before */ })
    for (const key of keys) paramsProxy[key] = overrides[key]!
    const w = canvasW.value, h = canvasH.value
    offEngine = new ShapeEngine(document.createElement('canvas'), w, h)
    // Important 5 (final review): this is a bake (a Collection sweep row), not a live
    // preview — unclamp any shader fill to this throwaway engine's actual size.
    offEngine.setBake(true)
    offEngine.setConfig(config.value)
    offEngine.render(orbit)
    return await offEngine.frameToBlob(w, h)
  } catch (e) {
    console.error('[shape-studio] param-baker render failed', e)
    return null
  } finally {
    offEngine?.dispose()
    for (const key of keys) {
      const prev = snapshot.get(key)
      if (prev !== undefined) paramsProxy[key] = prev
    }
  }
}

// ── real file download (distinct from exportPng, which is the canvas "As image" action:
// it uploads + drops an Image node + closes the studio). This one just saves a PNG. ─────────
async function downloadPng() {
  if (!engine) return
  const blob = await engine.frameToBlob(canvasW.value, canvasH.value)
  downloadBlobAsFile(blob, `shape_${Date.now()}.png`)
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
          @pointerdown="onPointerDown"
          @wheel.prevent="onWheel"
        />
        <div v-if="!webglOk" class="absolute inset-0 flex items-center justify-center text-xs text-white/50">
          3D preview unavailable on this device.
        </div>
        <div v-else-if="frozenFieldCount > 0"
             class="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-amber-400/30 bg-black/70 px-3 py-2 text-[11px] text-amber-200/90">
          {{ frozenFieldCount }} shader fill{{ frozenFieldCount > 1 ? 's' : '' }} frozen — too many live shader
          fields at once (limit {{ LIVE_FIELD_CEILING }}). Remove a shader fill for full motion.
        </div>
      </div>
    </template>
    <template #actions>
      <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
      <StudioActionsFooter :spec="{
        status: { saving: autoSaving, saved: autoSaved, error: actionError || null },
        utilities: [
          { label: 'Import settings', onClick: triggerImport },
          { label: 'Export settings', onClick: exportSettings },
        ],
        downloads: [{ label: 'Download PNG', onClick: downloadPng, disabled: !webglOk }],
        canvas: [{ label: 'As image', onClick: exportPng, busy: exporting, disabled: !webglOk }],
      }" />
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

      <!-- Schema-driven inspector: every slider/select/color declared in SHAPE_CONTROLS,
           grouped into Form/Shape/Palette/Fill/Style cards per SHAPE_SECTIONS. Bespoke
           blocks (harmony grid, palette preview, base-colour swatch, transparent-bg
           switch, shader fill editor, section lock toggles) are injected via named
           slots so they land inside the right card without going through the generic
           slider/select/color renderers. -->
      <StudioControlPanel
        :controls="SHAPE_CONTROLS"
        :order="SHAPE_SECTIONS"
        :value="(k: string) => paramsProxy[k] as string | number | boolean"
        :visible="controlVisible"
        :bound-for="boundColumnFor"
        :go-to-collection="goToCollection"
        @set="setShapeControl"
        @promote="promoteShapeControl"
        @menu="(e: MouseEvent, c: ControlSpec) => openVarMenu(e, c)"
      >
        <!-- Shape: lock badge moved into the card body (the panel has no header-badge
             slot) — still gates reroll via config.locks.shape. -->
        <template #section-Shape>
          <div class="flex justify-end">
            <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('shape')">
              <component :is="locked('shape') ? Lock : Unlock" class="h-3 w-3" />
            </button>
          </div>
        </template>

        <!-- Palette: bespoke 2-column harmony grid (ControlSpec has no label-map, so a
             dropdown would regress this) — still gets the same glyph/promote/bound-row
             treatment the panel gives every other select. -->
        <template #control-palette.harmony="slotProps">
          <label class="mb-1 flex items-center gap-1.5 text-[11px] text-white/55 group">
            <span>Harmony</span>
            <VariableGlyph
              :bound="boundColumnFor('palette.harmony')"
              @promote="promoteShapeControl(slotControl(slotProps))"
              @menu="(e: MouseEvent) => openVarMenu(e, slotControl(slotProps))"
            />
          </label>
          <div v-if="boundColumnFor('palette.harmony')" class="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
            <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ boundColumnFor('palette.harmony') }}</span>
            <button type="button" @click="goToCollection?.()"
                    class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
          </div>
          <div v-else class="grid grid-cols-2 gap-1">
            <button
              v-for="h in HARMONY_TYPES" :key="h" type="button"
              class="rounded px-2 py-1 text-left text-[11px] transition-colors"
              :class="config.palette.harmony === h ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'"
              @click="setShapeControl('palette.harmony', h)"
            >{{ HARMONY_LABELS[h] }}</button>
          </div>
        </template>
        <!-- Palette: read-only preview strip + derived base-colour swatch (a 3-way setter
             over hue/saturation/lightness — no single ControlSpec can express it) + the
             section's lock badge. Lands after the schema-driven controls. -->
        <template #section-Palette>
          <StudioColorField label="Base color" v-model="baseColorHex" />
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Preview</label>
            <div class="h-4 rounded" :style="{ background: paletteRampCss }" />
            <div class="mt-1 flex h-2.5 gap-0.5 overflow-hidden rounded">
              <div v-for="(c, i) in paletteSwatches" :key="i" class="flex-1" :style="{ background: c }" />
            </div>
          </div>
          <div class="flex justify-end">
            <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('palette')">
              <component :is="locked('palette') ? Lock : Unlock" class="h-3 w-3" />
            </button>
          </div>
        </template>

        <!-- Fill: colour swatches already had a bind affordance (FillSwatch) before this
             task — kept hand-written since they're hidden while fill.type is 'shader'
             (a guard SHAPE_CONTROLS' `when` can't express, being unrelated to fillMode). -->
        <template #control-fill.a="slotProps">
          <StudioColorField
            v-if="config.fill.type !== 'shader'"
            label="Color 1" :model-value="config.fill.a" :bound="boundColumnFor('fill.a')" :bindable="true"
            @update:model-value="(v: string) => setShapeControl('fill.a', v)"
            @promote="promoteShapeControl(slotControl(slotProps))"
            @menu="(e: MouseEvent) => openVarMenu(e, slotControl(slotProps))"
            @go-to-collection="goToCollection"
          />
        </template>
        <template #control-fill.b="slotProps">
          <StudioColorField
            v-if="config.fill.type !== 'shader'"
            label="Color 2" :model-value="config.fill.b" :bound="boundColumnFor('fill.b')" :bindable="true"
            @update:model-value="(v: string) => setShapeControl('fill.b', v)"
            @promote="promoteShapeControl(slotControl(slotProps))"
            @menu="(e: MouseEvent) => openVarMenu(e, slotControl(slotProps))"
            @go-to-collection="goToCollection"
          />
        </template>
        <!-- Fill: shader effect editor (dynamically-keyed per-effect params — no fixed
             ControlSpec fits) + the section's lock badge (same config.locks.palette key
             the Palette card's badge toggles — Fill and Palette are mutually exclusive
             views of the same lock). -->
        <template #section-Fill>
          <ShaderFillEditor
            v-if="config.fill.type === 'shader'"
            :model-value="config.fill.shader ?? DEFAULT_SHADER_SPEC"
            @update:model-value="(v: ShaderSpec) => { config.fill.shader = v }"
          />
          <div class="flex justify-end">
            <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('palette')">
              <component :is="locked('palette') ? Lock : Unlock" class="h-3 w-3" />
            </button>
          </div>
        </template>

        <!-- Style: transparent-background switch (style.background is a hex-or-
             'transparent' union — one `color` ControlSpec can't express it) + the
             background swatch itself, still gaining the glyph/bound-row like every
             other promoted control. -->
        <template #control-style.background="slotProps">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Transparent background</span>
            <StudioSwitch v-model="bgTransparent" />
          </div>
          <div v-if="!bgTransparent" class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-[11px] text-white/55 group">
              <span>Background</span>
              <VariableGlyph
                :bound="boundColumnFor('style.background')"
                @promote="promoteShapeControl(slotControl(slotProps))"
                @menu="(e: MouseEvent) => openVarMenu(e, slotControl(slotProps))"
              />
            </label>
            <div v-if="boundColumnFor('style.background')" class="flex flex-1 items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
              <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ boundColumnFor('style.background') }}</span>
              <button type="button" @click="goToCollection?.()"
                      class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">Edit in table</button>
            </div>
            <StudioColor v-else v-model="bgColorProxy" />
          </div>
        </template>
        <template #section-Style>
          <div class="flex justify-end">
            <button type="button" class="text-white/30 hover:text-white/70" @click.stop="toggleLock('style')">
              <component :is="locked('style') ? Lock : Unlock" class="h-3 w-3" />
            </button>
          </div>
        </template>
      </StudioControlPanel>

      <!-- Canvas (not lockable) -->
      <StudioSection title="Canvas">
        <StudioSelect label="Aspect" v-model="aspectKey" :options="ASPECT_OPTIONS" />
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
