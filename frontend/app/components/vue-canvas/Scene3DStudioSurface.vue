<script setup lang="ts">
// Fullscreen editor for the 3D Studio node. StudioModalShell chrome; the
// preview slot hosts a live Three.js viewport (SceneEngine + SceneInteraction),
// the controls rail is doc-driven sections. All state lives in a SceneDoc —
// on bake we render the three passes off-screen, upload them, and write the
// filenames + serialized doc back onto the node's widgets (PoseMannequin flow).
//
// Kit note: the studio control components (StudioSlider/StudioColor/StudioSegmented/
// StudioSelect/StudioSwitch) all use `v-model` (defineModel), and only StudioSlider
// carries a `label` prop — the others take just `options`/nothing, so their labels
// live in surrounding markup (mirrors ShapeStudioSurface.vue). Enum-union fields go
// through string proxies because StudioSegmented/StudioSelect models are `string`.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import {
  Box, Boxes, Plus, Loader2, Upload, Lightbulb, Sparkles, Shuffle, Group, Ungroup, ClipboardPaste,
} from 'lucide-vue-next'
import {
  parseDoc, serializeDoc, createPrimitive, createGlbObject, createLight, createGroup,
  LIGHTING_PRESETS, MATERIAL_TYPES, MATERIAL_DEFAULTS, LIGHT_KINDS, LIGHT_DEFAULTS, lightIntensityMax, gradientAngles, gradientStopsOf,
  DEFAULT_FONT_URL, sceneHasShaderFill,
  type SceneDoc, type SceneObject, type PrimitiveObject, type PrimitiveKind, type MaterialType, type GradientStop, type LightKind, type LightObject, type ReliefSpec, type SceneMaterial,
} from '~/lib/scene3d/config'
import { MATCAP_IDS, matcapThumb, onTextureError } from '~/lib/scene3d/materials'
import { toHeightPixels, heightGradient, RELIEF_FLAT_THRESHOLD } from '~/lib/scene3d/relief'
import { DEFAULT_SHADER_SPEC, normalizeShaderSpec, type ShaderSpec } from '~/lib/spacetype/fillTile'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { LIVE_FIELD_CEILING } from '~/lib/shaderfill/descriptor'
import { AVAILABLE_FONTS, loadFont, fontDisplayName, parseGoogleFontValue } from '~/lib/scene3d/outlines'
import { loadGoogleCatalog, type GoogleFont } from '~/data/google-fonts'
import FontPicker from '~/components/vue-canvas/FontPicker.vue'
import { PRIM_GROUPS } from '~/lib/scene3d/primGroups'
import { SceneEngine, baseSizeFor, baseVertexCountFor } from '~/lib/scene3d/engine'
import { rebaseMany, groupObjects, ungroupMany, rootObjects, descendantIds, cloneSubtree, axisDeltaWrites } from '~/lib/scene3d/hierarchy'
import Scene3DObjectRow from './studio/Scene3DObjectRow.vue'
import { totalClones } from '~/lib/scene3d/modifiers'
import { PRIMITIVE_PARAMS, paramValue, MODIFIER_SPECS, modifierValue } from '~/lib/scene3d/primParams'
import { SceneInteraction } from '~/lib/scene3d/interaction'
import { loadGlb, GLB_SIZE_CAP_BYTES } from '~/lib/scene3d/glb'
import { fitGlbGroup } from '~/lib/scene3d/fitGlb'
import { svgToLeafPaths, outlineStrokes, type SvgLeafPath } from '~/composables/useVectorSvg'
import { buildSvgObjects, SVG_SPLIT_THRESHOLD } from '~/lib/scene3d/svgImport'
import { renderPasses } from '~/lib/scene3d/passes'
import { encodeFrames } from '~/lib/engine/encodeVideo'
import { SCENE_TEMPLATES, animateSceneDefaults } from '~/lib/scene3d/motion/defaults'
import { LOOP_OPTIONS, IN_OPTIONS, OUT_OPTIONS, CAMERA_OPTIONS, LOOP_USES_AMOUNT, CAMERA_USES_CYCLES, CAMERA_USES_AMOUNT, setObjectLoop, setObjectTransition, setObjectDirection } from '~/lib/scene3d/motion/panel'
import { sceneHasMotion, renderMotionFrame } from '~/lib/scene3d/motion/render'
import { applyMotionToDoc } from '~/lib/scene3d/motion/apply'
import { EASE_PRESETS, presetKeyForEaseRef, easeRefForPresetKey, easeRefToCurveString, curveStringToEaseRef } from '~/lib/scene3d/motion/easePresets'
import type { LoopKind, TransitionPreset, CameraMotion, Direction } from '~/lib/scene3d/motion/types'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { useInpaint } from '~/composables/useInpaint'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioGradientRamp from '~/components/vue-canvas/studio/StudioGradientRamp.vue'
import ShaderFillEditor from '~/components/vue-canvas/widgets/ShaderFillEditor.vue'
import Scene3DMotionTimeline from '~/components/vue-canvas/Scene3DMotionTimeline.vue'
import CurveEditor from '~/components/vue-canvas/CurveEditor.vue'

const props = withDefaults(defineProps<{ nodeId: string; nodes?: any[]; edges?: any[] }>(), {
  nodes: () => [], edges: () => [],
})
const emit = defineEmits<{ close: [] }>()

// Node widget access — same conventions as PoseEditorModal (widgetDefs/widgetsValues).
const node = computed(() => props.nodes.find((n: any) => String(n.id) === String(props.nodeId)))
function widgetIdx(name: string): number { return node.value?.data?.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }
function widgetStr(name: string): string { const i = widgetIdx(name); return i >= 0 ? String(node.value?.data?.widgetsValues?.[i] ?? '') : '' }
function setWidget(name: string, value: any) {
  const i = widgetIdx(name)
  if (i >= 0 && node.value?.data?.widgetsValues) node.value.data.widgetsValues[i] = value
}

// ── Document state ────────────────────────────────────────────────────────────
const doc = reactive<SceneDoc>(parseDoc(widgetStr('scene_state')))
// Selection is an ORDERED list; the LAST entry is the primary (the anchor the
// properties panel titles itself after, and the object a single-selection gizmo
// attaches to). `selectedId` stays available as a computed so the dozen
// existing single-selection readers keep working unchanged — but note it is
// WRITABLE, and writing it REPLACES the selection. Any code that needs to add
// to the selection must go through `toggleSelected`.
const selectedIds = ref<string[]>([])
const selectedId = computed<string | null>({
  get: () => selectedIds.value[selectedIds.value.length - 1] ?? null,
  set: (id) => { selectedIds.value = id ? [id] : [] },
})
const selectedObjects = computed<SceneObject[]>(() =>
  selectedIds.value
    .map((id) => doc.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o))
// A one-object "group" is a legal state groupObjects would happily create, but
// it is pointless (nothing to keep together) and the toolbar deliberately
// doesn't offer it — hence >= 2, not >= 1.
const canGroup = computed(() => selectedIds.value.length >= 2)
const canUngroup = computed(() => selectedObjects.value.some((o) => o.kind === 'group'))
// The object list renders this tree rather than `doc.objects` directly — the
// doc itself stays a flat array plus `parentId`; only the render is nested.
const rootObjectList = computed(() => rootObjects(doc.objects))

function toggleSelected(id: string, additive: boolean): void {
  if (!additive) { selectedIds.value = [id]; return }
  const i = selectedIds.value.indexOf(id)
  // Re-selecting an already-selected object promotes it to primary rather than
  // deselecting it when it is the only member — deselecting the last object via
  // a modifier-click is a dead end the user has to undo with another click.
  if (i < 0) selectedIds.value = [...selectedIds.value, id]
  else if (selectedIds.value.length > 1) selectedIds.value = selectedIds.value.filter((x) => x !== id)
}
const selected = computed<SceneObject | null>(() => doc.objects.find((o) => o.id === selectedId.value) ?? null)
const selectedIsPrimitive = computed(() => selected.value?.kind === 'primitive')
const selectedIsGlb = computed(() => selected.value?.kind === 'glb')
// GLBs render their imported materials until the override switch is on; the
// material editor's controls only appear (and bind) when they'd have an effect.
const matOverride = computed<boolean>({
  get: () => selected.value?.kind === 'glb' && selected.value.materialOverride === true,
  set: (v) => { const o = selected.value; if (o?.kind === 'glb') o.materialOverride = v },
})
const matEditable = computed(() => selectedIsPrimitive.value || matOverride.value)
const selectedIsLight = computed(() => selected.value?.kind === 'light')
const selectedLight = computed<LightObject | null>(() => (selected.value?.kind === 'light' ? selected.value : null))
const activeTab = ref<'build' | 'motion'>('build')  // inspector tab: Build (existing sections) vs Motion (Task 5)

// ── Motion panel state (Task 5) ──────────────────────────────────────────────
const motionOn = computed({
  get: () => sceneHasMotion(doc),
  set: (on: boolean) => {
    if (on) animateSceneDefaults(doc)
    else { doc.objects.forEach((o) => (o.motion = undefined)); doc.camera.motion = undefined }
  },
})
function applyTemplate(name: 'showcase' | 'reveal' | 'loop') { SCENE_TEMPLATES[name](doc) }

const DIRECTION_OPTIONS: Direction[] = ['left', 'right', 'top', 'bottom']
// Ease picker options: preset KEYS (StudioSelect displays/binds the string key itself) + 'custom'.
const EASE_KEY_OPTIONS: string[] = [...EASE_PRESETS.map((p) => p.key), 'custom']

// Ease picker proxy for a transition slot ('in'|'out') on the currently selected object.
function easeKey(slot: 'in' | 'out'): string {
  const t = selected.value?.motion?.[slot]
  return t ? presetKeyForEaseRef(t.ease) : 'ease-out'
}
function setEaseKey(slot: 'in' | 'out', key: string) {
  const t = selected.value?.motion?.[slot]
  if (!t || key === 'custom') return
  t.ease = easeRefForPresetKey(key)
}
function curveProxy(slot: 'in' | 'out'): string | null {
  const t = selected.value?.motion?.[slot]
  if (!t) return null
  return easeRefToCurveString(t.ease)
}
function setCurve(slot: 'in' | 'out', v: string) {
  const t = selected.value?.motion?.[slot]
  if (t) t.ease = curveStringToEaseRef(v)
}

// ── Transport / playback (Task 6) ────────────────────────────────────────────
const playing = ref(false)
const playhead = ref(0)     // seconds
let playStart = 0           // performance.now anchor
function togglePlay() {
  if (!sceneHasMotion(doc)) return
  playing.value = !playing.value
  if (playing.value) playStart = performance.now() - playhead.value * 1000
}
// Export the Motion timeline as an mp4 (reuses the studios' bake→encode pipeline —
// same renderMotionFrame path the live preview uses, so the clip matches playback
// exactly). Renders N = fps*duration frames off-screen at the output resolution,
// bakes/encodes server-side, downloads the file. Playback is paused for the duration
// so it can't interleave renders with the export loop.
// NOTE: no tab store here (unlike ArtifactFrameNode), so this does not record the
// export to the Assets panel — follow-up for 2b if that's wanted from this surface.
async function exportVideo() {
  if (!engine || !sceneHasMotion(doc)) return
  const wasPlaying = playing.value; playing.value = false
  try {
    const W = doc.output.width, H = doc.output.height
    const fps = doc.motion.fps, dur = doc.motion.duration
    const total = Math.max(1, Math.round(fps * dur))
    engine.setSize(W, H)
    const { ensureSpaceTypeBake } = await import('~/lib/spacetype/bake')
    const cfg = { fps, loopDuration: dur, W, H, seed: 'scene3d', sig: JSON.stringify({ id: props.nodeId, n: total, w: W, h: H, s: serializeDoc(doc) }) }
    const bake = await ensureSpaceTypeBake(cfg as any, undefined, {
      renderFrame: async (i) => {
        const cv = renderMotionFrame(engine!, doc, total > 1 ? i / total : 0)
        return await new Promise<Blob>((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'))
      },
    })
    let encoded: Awaited<ReturnType<typeof encodeFrames>>
    try {
      encoded = await encodeFrames({ frames: bake.frames, fps, width: W, height: H })
    } catch {
      bakeError.value = 'Video encode failed'
      return
    }
    const vres = await fetch(`/view?${new URLSearchParams({ filename: encoded.filename, type: 'input' })}`)
    const blob = await vres.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = obj; a.download = `scene3d-${props.nodeId}.${encoded.ext}`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(obj)
  } catch (err) {
    bakeError.value = 'Video export failed'
    console.error('[Scene3D] video export failed:', err)
  } finally {
    // restore the viewport render size and Build pose
    engine?.setSize(canvasEl.value?.clientWidth ?? doc.output.width, canvasEl.value?.clientHeight ?? doc.output.height)
    engine?.syncFromDoc(doc); engine?.applyObjectOpacities({})
    playing.value = wasPlaying
  }
}
watch(playing, (v) => {
  if (!v && engine) { engine.syncFromDoc(doc); engine.applyObjectOpacities({}) }
})

const snap = ref(false)
const lightView = ref(false)  // clay + light-widget preview mode (Task 1/3 engine support)
const dirty = ref(false)      // doc changed since last bake
const baking = ref(false)
const bakeError = ref('')       // last export failure message (inline "retry")
const savedFlash = ref(false)   // transient "Saved ✓" confirmation after Save
let savedTimer: ReturnType<typeof setTimeout> | null = null
const glbError = reactive<Record<string, boolean>>({})
const webglOk = ref(true)
const uploading = ref(false)    // GLB file upload in flight
const uploadError = ref('')     // inline error for the Upload GLB control
const glbFileInput = ref<HTMLInputElement | null>(null)

// ── SVG import ────────────────────────────────────────────────────────────────
const svgFileInput = ref<HTMLInputElement | null>(null)
const svgPasteOpen = ref(false)
const svgPasteText = ref('')
const svgError = ref<string | null>(null)
/** Set when a source exceeds SVG_SPLIT_THRESHOLD: the user picks split or merged
 *  before anything is added, so a 247-path map can never silently flood the
 *  scene AND we never silently truncate their artwork. */
const svgPending = ref<{ paths: SvgLeafPath[]; name: string } | null>(null)

// ── Add-primitive menu ──────────────────────────────────────────────────────
const primMenuOpen = ref(false)

function pickPrimitive(kind: PrimitiveKind) {
  addPrimitive(kind)
  primMenuOpen.value = false
}

// Outside click closes the menu (registered only while open).
function onPrimMenuOutside(e: PointerEvent) {
  if (!(e.target as HTMLElement)?.closest?.('[data-prim-menu]')) primMenuOpen.value = false
}
watch(primMenuOpen, (open) => {
  if (open) window.addEventListener('pointerdown', onPrimMenuOutside, true)
  else window.removeEventListener('pointerdown', onPrimMenuOutside, true)
})

// ── Add-light menu ──────────────────────────────────────────────────────────
const lightMenuOpen = ref(false)
const LIGHT_KIND_LABELS: Record<LightKind, string> = { point: 'Point', spot: 'Spot', rect: 'Area' }

function onLightMenuOutside(e: PointerEvent) {
  if (!(e.target as HTMLElement)?.closest?.('[data-prim-menu]')) lightMenuOpen.value = false
}
watch(lightMenuOpen, (open) => {
  if (open) window.addEventListener('pointerdown', onLightMenuOutside, true)
  else window.removeEventListener('pointerdown', onLightMenuOutside, true)
})

// ── Generate panel (text → image review → make 3D → insert) ────────────────
const GEN_3D_MODELS = ['hunyuan3d-v2', 'trellis-2', 'tripo-v2.5', 'triposr']
const genOpen = ref(false)
const genPrompt = ref('')
const genImageUrl = ref<string | null>(null)
const genSeed = ref(Math.floor(Math.random() * 2e9))
const gen3dModel = ref('hunyuan3d-v2')
const genTextured = ref(false)
const genStage = ref<'idle' | 'image' | 'review' | 'making' | 'error'>('idle')
const genError = ref('')

function onGenMenuOutside(e: PointerEvent) {
  if (!(e.target as HTMLElement)?.closest?.('[data-prim-menu]')) genOpen.value = false
}
watch(genOpen, (open) => {
  if (open) window.addEventListener('pointerdown', onGenMenuOutside, true)
  else window.removeEventListener('pointerdown', onGenMenuOutside, true)
})

async function genImage() {
  genStage.value = 'image'
  genError.value = ''
  try {
    const r = await $fetch('/api/scene3d/gen-image', { method: 'POST', body: { prompt: genPrompt.value, seed: genSeed.value } })
    genImageUrl.value = r.imageUrl
    genSeed.value = r.seed
    genStage.value = 'review'
  } catch (err) {
    console.error('[scene3d-studio] gen-image failed', err)
    genError.value = 'Image generation failed — try again.'
    genStage.value = 'error'
  }
}
function reroll() {
  genSeed.value = Math.floor(Math.random() * 2e9)
  genImage()
}
// Make 3D: fal image→3D, then insert the result with the auto-fit BAKED INTO
// the object's own transform (position/scale) rather than applied generically
// in loadGlb/addGlb — that would re-scale every GLB, including ones already
// placed and sized in saved scenes. Mirrors addGlb's create+push+warm-up shape.
async function make3d() {
  if (!genImageUrl.value) return
  genStage.value = 'making'
  genError.value = ''
  try {
    const r = await $fetch('/api/scene3d/gen-3d', {
      method: 'POST',
      body: { imageUrl: genImageUrl.value, model: gen3dModel.value, textured: genTextured.value },
    })
    const group = await loadGlb(r.glbUrl)
    fitGlbGroup(group)
    const o = createGlbObject(r.glbUrl, doc.objects)
    o.position = [group.position.x, group.position.y, group.position.z]
    o.scale = [group.scale.x, group.scale.y, group.scale.z]
    doc.objects.push(o)
    selectedId.value = o.id
    genOpen.value = false
    genStage.value = 'idle'
    genImageUrl.value = null
  } catch (err) {
    console.error('[scene3d-studio] gen-3d failed', err)
    genError.value = '3D generation failed — try again.'
    genStage.value = 'error'
  }
}

// Wired glb_url (from a Model3D / Text node), if any — offered as an import
// shortcut. glb_url is a STRING *widget*, so it never appears in data.inputs
// (the link-slot list); the node card renders its wiring handle at the fallback
// index 0 (Scene3DStudioNode.glbInIdx). Mirror that fallback here so an upstream
// URL edge — anchored to `input-0` — is actually detected. Ids are coerced with
// String() because edge/node ids can be numbers or strings depending on source.
const wiredGlbUrl = computed<string>(() => {
  const found = node.value?.data?.inputs?.findIndex((i: any) => i.name === 'glb_url') ?? -1
  const idx = found >= 0 ? found : 0
  const edge = props.edges.find((e: any) => String(e.target) === String(props.nodeId) && e.targetHandle === `input-${idx}`)
  const src = edge ? props.nodes.find((n: any) => String(n.id) === String(edge.source)) : null
  const t = src?.data?.text
  // Only accept strings that actually reference a .glb file (optionally followed by
  // a query/hash) — no bare "any http URL" acceptance, which would offer to import
  // non-model links wired into the slot.
  return typeof t === 'string' && /\.glb(\?|#|$)/i.test(t) ? t : ''
})

// ── Enum / composite field proxies (StudioSegmented/StudioSelect models are string) ─────
function enumProxy<T extends string>(get: () => T, set: (v: T) => void) {
  return computed<string>({ get, set: (v: string) => set(v as T) })
}
const lightingPresetProxy = enumProxy(() => doc.lighting.preset, (v) => { doc.lighting.preset = v })

const OUTPUT_OPTIONS = ['1024×1024', '1344×768', '768×1344']
const outputProxy = computed<string>({
  get: () => `${doc.output.width}×${doc.output.height}`,
  set: (v) => { const [w, h] = v.split('×').map(Number); doc.output.width = w ?? 1024; doc.output.height = h ?? 1024 },
})

// Background transparency toggle — remember the last real color so toggling back
// restores it instead of landing on black.
const lastBgColor = ref(doc.background === 'transparent' ? '#1b1e24' : doc.background)
const bgTransparent = computed<boolean>({
  get: () => doc.background === 'transparent',
  set: (v) => {
    if (v) { if (doc.background !== 'transparent') lastBgColor.value = doc.background; doc.background = 'transparent' }
    else { doc.background = lastBgColor.value }
  },
})
const bgColorProxy = computed<string>({
  get: () => (doc.background === 'transparent' ? lastBgColor.value : doc.background),
  set: (v) => { doc.background = v; lastBgColor.value = v },
})

/** Material edits apply to EVERY selected object — this is what makes "select
 *  the logo's paths, pick gold" one action instead of twelve. Each object keeps
 *  its own material afterward, so a single path can still be tweaked alone.
 *  Groups and lights carry a dummy `DEFAULT_MATERIAL` that is never rendered
 *  (see their `create*` doc comments in config.ts) — mutating it would be a
 *  silent no-op at best, so both kinds are skipped rather than included.
 *
 *  A GLB without `materialOverride` is skipped for the same reason and one
 *  worse: its `material` isn't rendered either (the imported materials are),
 *  but it IS kept, so a GLB sitting in a multi-selection would silently bank
 *  every edit made while it was there and dump them all on the scene the day
 *  someone flips the override switch. This mirrors `isEditableMaterial` in
 *  controls.ts, which already draws the line in the same place. */
function applyMaterial(mutate: (m: SceneMaterial) => void) {
  for (const o of selectedObjects.value) {
    if (o.kind === 'light' || o.kind === 'group') continue
    if (o.kind === 'glb' && o.materialOverride !== true) continue
    mutate(o.material)
  }
}

// Selection field proxies — nullable-safe so vue-tsc stays happy without template narrowing.
// get() reads the PRIMARY selection only (what the panel displays); set() fans out to every
// selected object via applyMaterial (what actually gets edited) — see its doc above.
const matColor = computed<string>({ get: () => selected.value?.material.color ?? '#9aa3af', set: (v) => applyMaterial((m) => { m.color = v }) })
const matRoughness = computed<number>({ get: () => selected.value?.material.roughness ?? 0.6, set: (v) => applyMaterial((m) => { m.roughness = v }) })
const matMetalness = computed<number>({ get: () => selected.value?.material.metalness ?? 0, set: (v) => applyMaterial((m) => { m.metalness = v }) })

// Material type + per-type params. Proxies fall back to MATERIAL_DEFAULTS so
// sliders always have a number; the doc only records what the user touches.
const matType = computed<MaterialType>({
  get: () => selected.value?.material.type ?? 'standard',
  set: (v) => applyMaterial((m) => { m.type = v }),
})
function matParam<K extends keyof typeof MATERIAL_DEFAULTS>(key: K) {
  return computed<any>({
    get: () => (selected.value?.material as any)?.[key] ?? MATERIAL_DEFAULTS[key],
    set: (v) => applyMaterial((m) => { (m as any)[key] = v }),
  })
}
const matShininess = matParam('shininess')
const matSpecular = matParam('specular')
const matToonSteps = matParam('toonSteps')
const matMatcap = matParam('matcap')
const matIor = matParam('ior')
const matTransmission = matParam('transmission')
const matThickness = matParam('thickness')
const matFresnelColor = matParam('fresnelColor')
const matFresnelPower = matParam('fresnelPower')
const matGradientShading = matParam('gradientShading')
const matGradientType = matParam('gradientType')
const matGradientOffset = matParam('gradientOffset')
const matGradientSpread = matParam('gradientSpread')

// Direction angles read through gradientAngles() so an untouched material still
// reflects its legacy `gradientAxis` seed; writing always stores explicit angles.
function angleProxy(key: 'yaw' | 'pitch') {
  return computed<number>({
    get: () => (selected.value ? gradientAngles(selected.value.material)[key] : MATERIAL_DEFAULTS[key === 'yaw' ? 'gradientYaw' : 'gradientPitch']),
    set: (v) => applyMaterial((m) => { m[key === 'yaw' ? 'gradientYaw' : 'gradientPitch'] = v }),
  })
}
const matGradientYaw = angleProxy('yaw')
const matGradientPitch = angleProxy('pitch')

// The X/Y/Z presets must write the ANGLES, not `gradientAxis` — once explicit
// angles exist on the material the axis field is only a seed and would look dead.
const AXIS_PRESETS = { x: { yaw: 90, pitch: 0 }, y: { yaw: 0, pitch: 90 }, z: { yaw: 0, pitch: 0 } } as const
function applyAxisPreset(axis: 'x' | 'y' | 'z') {
  const p = AXIS_PRESETS[axis]
  applyMaterial((m) => { m.gradientYaw = p.yaw; m.gradientPitch = p.pitch })
}
function isAxisPreset(axis: 'x' | 'y' | 'z') {
  const p = AXIS_PRESETS[axis]
  return matGradientYaw.value === p.yaw && matGradientPitch.value === p.pitch
}

// Stops: read through gradientStopsOf() so an untouched material shows the pair
// synthesized from `color` + `gradientB`; the array materializes on first edit.
const matGradientStops = computed<GradientStop[]>({
  get: () => (selected.value ? gradientStopsOf(selected.value.material) : []),
  // Cloned per object rather than assigning the same `v` array to every
  // selected material — the array (and its stop objects) must not become one
  // mutable reference shared across objects, same hazard cloneMaterial's fix
  // above documents for `relief`/`shader`.
  set: (v) => applyMaterial((m) => { m.gradientStops = v.map((s) => ({ ...s })) }),
})
const matClearcoat = matParam('clearcoat')
const matClearcoatRoughness = matParam('clearcoatRoughness')
const matSheen = matParam('sheen')
const matSheenColor = matParam('sheenColor')
const matEmissive = matParam('emissive')
const matEmissiveIntensity = matParam('emissiveIntensity')
const matOpacity = matParam('opacity')
const matDispersion = matParam('dispersion')
const matAttenuationColor = matParam('attenuationColor')
const matAttenuationDistance = matParam('attenuationDistance')
const matIridescence = matParam('iridescence')
const matIridescenceIOR = matParam('iridescenceIOR')
const matEnvMapIntensity = matParam('envMapIntensity')

// ── shaderFill (object anchor only — Task 7) ─────────────────────────────────
// Hand-wired: Scene3D has no control-schema/agent path (unlike Space Type/Shape Studio's
// declarative control schema), so effect/speed/unlit/input-colour live here as plain proxies
// rather than derived from a shared descriptor list. A known, deliberate gap — see the task
// report.
const matUnlit = matParam('unlit')
const matShader = computed<ShaderSpec>({
  get: () => selected.value?.material.shader ?? DEFAULT_SHADER_SPEC,
  // Deep-cloned per object (JSON round-trip, same as cloneMaterial's own shader
  // handling) rather than assigning `v` to every selected material — a shared
  // spec object would mean editing one object's shaderFill silently edits them
  // all, the same hazard as material.relief's documented shallow-copy bug.
  set: (v) => applyMaterial((m) => { m.shader = JSON.parse(JSON.stringify(v)) }),
})

// ── Surface relief (Task 5) — orthogonal to material type, so its proxies read/write
// `material.relief`/`material.normalImage` directly rather than going through matParam.
// Mirrors the shaderFill proxies' shape: get() falls back to a default, set() only writes
// once a `relief` object exists (matReliefSource's setter is what creates it).
const matReliefSource = computed<'none' | 'shader' | 'image'>({
  get: () => selected.value?.material.relief?.source ?? 'none',
  set: (v) => {
    applyMaterial((mat) => {
      const relief: ReliefSpec = { ...(mat.relief ?? { scale: MATERIAL_DEFAULTS.reliefScale }), source: v }
      // Selecting 'shader' must SEED relief.spec, not just switch the source: matReliefSpec's
      // getter falls back to DEFAULT_SHADER_SPEC for display, so without this the editor shows
      // a fully-configured effect while the persisted state has no spec at all — materials.ts's
      // getShaderHeightTexture then has neither `spec` nor `mat.shader` to render from and
      // returns null, so the relief silently never renders (Task 5 bug). Deep-clone via
      // normalizeShaderSpec (same helper parseDoc uses for this exact field) rather than
      // assigning the shared DEFAULT_SHADER_SPEC constant directly — that would let every
      // shader-relief material alias one mutable spec object, so editing one object's effect
      // would silently edit them all. Called once PER selected object (inside this loop) for
      // the same reason: a fan-out across a multi-selection must not let them alias each
      // other's spec either.
      // Deliberately NOT clearing `spec` when switching to 'none'/'image': keeping it lets a
      // user bounce between sources without losing their configured effect, which reads as
      // kinder than punishing an exploratory toggle.
      // Seed voronoi_cells instead of fbm_warp: bump responds to local gradient, not range.
      // fbm_warp gradient ≈5.4 (invisible), voronoi_cells ≈36.8 (reads as material surface).
      if (v === 'shader' && !relief.spec) relief.spec = normalizeShaderSpec({ effectId: 'voronoi_cells' }, 0)
      mat.relief = relief
    })
  },
})
const matReliefScale = computed<number>({
  get: () => selected.value?.material.relief?.scale ?? MATERIAL_DEFAULTS.reliefScale,
  set: (v) => applyMaterial((mat) => { if (mat.relief) mat.relief.scale = v }),
})
const matReliefInvert = computed<boolean>({
  get: () => selected.value?.material.relief?.invert === true,
  set: (v) => applyMaterial((mat) => { if (mat.relief) mat.relief.invert = v }),
})
// Contrast is applied at texture-build time alongside invert (materials.ts), not at
// upload/conversion time — so it's a live, adjustable knob for both the Effect and Image
// relief sources, without needing to re-upload anything. Repaints the material's own bump
// canvas IN PLACE (materials.ts's updateMaterial) rather than rebuilding — see the C1 fix.
const matReliefContrast = computed<number>({
  get: () => selected.value?.material.relief?.contrast ?? MATERIAL_DEFAULTS.reliefContrast,
  set: (v) => {
    applyMaterial((mat) => { if (mat.relief) mat.relief.contrast = v })
    // Minor 6 fix (final review): the flatness warning is measured ONCE, on the pre-contrast
    // pixels, at upload/generate time — raising Contrast can genuinely fix a flat-reading map,
    // but the warning (and its "raise Contrast" copy) never re-evaluated, so it sat there
    // contradicting a surface that now reads fine. Clear it on any contrast edit rather than
    // re-measuring — contrast is a live per-tick slider now, and re-decoding the whole source
    // image on every tick just to re-run heightGradient would be real, avoidable cost. The
    // warning is a per-object measurement, so this now clears it for every selected object
    // whose contrast the fan-out above just touched, not just the primary.
    for (const o of selectedObjects.value) delete reliefFlatWarning[o.id]
  },
})
// Tiling is a Texture.repeat property (materials.ts's applyRelief/updateMaterial), never a
// pixel change — updates in place exactly like scale, so a slider drag never rebuilds.
const matReliefTiling = computed<number>({
  get: () => selected.value?.material.relief?.tiling ?? MATERIAL_DEFAULTS.reliefTiling,
  set: (v) => applyMaterial((mat) => { if (mat.relief) mat.relief.tiling = v }),
})
const matReliefSpec = computed<ShaderSpec>({
  get: () => selected.value?.material.relief?.spec ?? DEFAULT_SHADER_SPEC,
  // Deep-cloned per object, same reasoning as matShader above — a relief spec
  // is a nested object too, and the ShaderFillEditor emits one fresh `v` shared
  // across this whole fan-out unless each object gets its own copy.
  set: (v) => applyMaterial((mat) => { if (mat.relief) mat.relief.spec = JSON.parse(JSON.stringify(v)) }),
})
/** Relief needs lighting to perturb. An unlit shaderFill is a MeshBasicMaterial with no
 *  bump slot at all — disable rather than silently no-op (materials.ts applyRelief). */
const reliefAvailable = computed(() => !(matType.value === 'shaderFill' && matUnlit.value))
// The uploaded/converted image, whichever channel currently holds it: relief.image
// (bump path) normally, or normalImage once "Already a normal map" moved it there.
// Read-only: writes go through the upload handler / matIsNormalMap below.
const matReliefImage = computed<string | undefined>(() => selected.value?.material.relief?.image ?? selected.value?.material.normalImage)
/** Whether the chosen relief image is a real tangent-space normal map (→ `.normalMap`)
 *  rather than a height field (→ `.bumpMap`). Toggling MOVES the filename between the
 *  two fields rather than gating a shared one, since they are genuinely different
 *  textures read by materials.ts — see SceneMaterial.normalImage's doc in config.ts. */
const matIsNormalMap = computed<boolean>({
  get: () => !!selected.value?.material.normalImage,
  set: (v) => {
    applyMaterial((mat) => {
      if (v) {
        const img = mat.relief?.image
        if (img) {
          mat.normalImage = img
          if (mat.relief) mat.relief.image = undefined
        }
      } else {
        const img = mat.normalImage
        if (img) {
          if (!mat.relief) mat.relief = { source: 'image', scale: MATERIAL_DEFAULTS.reliefScale }
          mat.relief.image = img
          mat.normalImage = undefined
        }
      }
    })
  },
})
// I3 fix (final review): `normalImage` is a field independent of `relief.source` (see its doc
// in config.ts) — materials.ts correctly keeps applying it no matter what Relief is set to,
// but the ONLY control that could touch it ("Already a normal map") used to render solely
// under `matReliefSource === 'image'`. Switching Relief to None/Effect after checking that box
// left the normal shading bound with no way to clear it. This is a plain discard, independent
// of matIsNormalMap's move-between-fields dance above (there is no relief.image to move it
// back to once the user has explicitly walked away from Image source).
function removeNormalMap() {
  applyMaterial((mat) => { mat.normalImage = undefined })
}

// Light field proxies — same shape as matParam, but the fields live flat on the
// LightObject itself (not nested under .material). Falls back to LIGHT_DEFAULTS
// so sliders always have a number even before the selected light's field is touched.
function lightParam<K extends keyof typeof LIGHT_DEFAULTS>(key: K) {
  return computed<any>({
    get: () => (selectedLight.value as any)?.[key] ?? LIGHT_DEFAULTS[key],
    set: (v) => { if (selectedLight.value) (selectedLight.value as any)[key] = v },
  })
}
const lightColor = lightParam('color')
const lightIntensity = lightParam('intensity')
// Point/spot are physical (candela, inverse-square), so their useful range runs
// far higher than an area light's — scale the slider ceiling to the light kind.
const lightIntensityMaxValue = computed(() => lightIntensityMax(selectedLight.value?.light ?? 'point'))
const lightDistance = lightParam('distance')
const lightDecay = lightParam('decay')
const lightAngle = lightParam('angle')
const lightPenumbra = lightParam('penumbra')
const lightWidth = lightParam('width')
const lightHeight = lightParam('height')
const lightCastShadow = lightParam('castShadow')

// Transparency group defaults open for glass. StudioSection's isOpen/@toggle
// pattern, scoped to the one sub-group with a dynamic default: the watch
// re-applies the default on material-type switches, @toggle keeps user toggles
// from being clobbered by later re-renders.
const transparencyOpen = ref(matType.value === 'glass')
watch(matType, (t) => { transparencyOpen.value = t === 'glass' })

// Image-material upload: file → dataURL → ComfyUI input dir → material.image.
// State is scoped to the object the upload was started FOR (not "whatever is
// selected when it finishes"): texUploading holds that object's id so the
// spinner only shows on it, and upload failures are keyed by object id
// (texUploadError) while engine-side load failures stay keyed by filename
// (texLoadError) — a failed replace must not smear the old, still-working file.
// Deliberately NOT routed through applyMaterial (Task 9): the spinner/error refs
// above are single-id, not sets, so fanning an upload across a multi-selection
// would need its own per-id async state, not a one-line change — a materially
// bigger change than the panel's synchronous sliders/colours below, and outside
// what this task's material fan-out targets.
const texFileInput = ref<HTMLInputElement | null>(null)
const texUploading = ref<string | null>(null)
const texUploadError = reactive<Record<string, boolean>>({})
const texLoadError = reactive<Record<string, boolean>>({})
function triggerTexUpload() { texFileInput.value?.click() }
// Same-origin /view URL for an uploaded input-dir file (used by the image preview).
function texViewUrl(filename: string) {
  return `/view?${new URLSearchParams({ filename, type: 'input' }).toString()}`
}
async function onTexFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  // Capture the target BEFORE any await: reselecting mid-upload must not land
  // the texture (or the error) on the newly selected object.
  const target = selected.value
  if (!file || !target || target.kind === 'light') return
  texUploading.value = target.id
  delete texUploadError[target.id]
  try {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('read failed'))
      r.readAsDataURL(file)
    })
    const filename = await inpaint.uploadDataUrl(dataUrl, `scene3d_tex_${props.nodeId}`)
    delete texLoadError[filename]
    target.material.image = filename
  } catch {
    texUploadError[target.id] = true
  } finally {
    if (texUploading.value === target.id) texUploading.value = null
  }
}
// Engine-side texture load failures (e.g. restored doc referencing a deleted
// file) surface the same inline note, keyed by filename.
let offTexError: (() => void) | null = null
onMounted(() => { offTexError = onTextureError((f) => { texLoadError[f] = true }) })
onBeforeUnmount(() => { offTexError?.() })

// Relief image upload: same object-scoped-spinner / capture-before-await shape as the
// texture upload above (texUploading/onTexFilePicked). C2 fix (final review): `relief.image`
// now stores the user's ORIGINAL uploaded bytes, unconverted — the client used to run the SAME
// luminance→height transform materials.ts's getHeightTexture already runs at build time, so
// (a) "Brightness" and "Use as-is" produced byte-identical output (toHeightPixels is idempotent
// on grayscale — Use-as-is did nothing) and (b) a real Blender/game-asset normal map uploaded
// through the default Brightness path got flattened to gray BEFORE it ever reached storage,
// unrecoverably — routing it to normalImage afterwards just bound a uniformly-tilted flat gray
// square. Conversion now happens exactly once, in materials.ts, at texture-build time — see its
// relief-section doc.
const reliefFileInput = ref<HTMLInputElement | null>(null)
const reliefUploading = ref<string | null>(null)
const reliefUploadError = reactive<Record<string, boolean>>({})
// Set once a relief image's local gradient is measured (upload path or generate path,
// below). true means the map is suspiciously flat and bump mapping will show ~nothing —
// see heightGradient/RELIEF_FLAT_THRESHOLD in lib/scene3d/relief.ts. Advisory only: the
// map is still applied, this just tells the user why they might not see anything.
const reliefFlatWarning = reactive<Record<string, boolean>>({})
function triggerReliefUpload() { reliefFileInput.value?.click() }
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read failed'))
    r.readAsDataURL(file)
  })
}
/** Decode a data URL, run the SAME default luminance conversion materials.ts applies at
 *  texture-build time (invert/contrast are per-material picks made AFTER upload, so there is
 *  no live value to measure against here — a genuinely smooth source reads as flat regardless
 *  of what the user later dials in), and measure its local gradient. The one guard shared by
 *  both the upload path and the generate path below. Measurement is advisory: callers should
 *  treat a rejection as "unknown" rather than a hard failure. */
function measureReliefFlatness(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) { reject(new Error('no 2d context')); return }
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, c.width, c.height)
      resolve(heightGradient(toHeightPixels(data.data, false, 1), c.width, c.height))
    }
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
}
async function onReliefFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  // Capture the target BEFORE any await: reselecting mid-upload must not land
  // the texture (or the error) on the newly selected object.
  const target = selected.value
  if (!file || !target || target.kind === 'light') return
  reliefUploading.value = target.id
  delete reliefUploadError[target.id]
  delete reliefFlatWarning[target.id]
  try {
    const rawUrl = await readAsDataUrl(file)
    const filename = await inpaint.uploadDataUrl(rawUrl, `scene3d_relief_${props.nodeId}`)
    delete texLoadError[filename]
    if (!target.material.relief) target.material.relief = { source: 'image', scale: MATERIAL_DEFAULTS.reliefScale }
    target.material.relief.source = 'image'
    target.material.relief.image = filename
    try {
      reliefFlatWarning[target.id] = (await measureReliefFlatness(rawUrl)) < RELIEF_FLAT_THRESHOLD
    } catch { /* measurement is advisory only — a failure here must not fail the upload */ }
  } catch {
    reliefUploadError[target.id] = true
  } finally {
    if (reliefUploading.value === target.id) reliefUploading.value = null
  }
}

// Relief generation: text prompt → /api/scene3d/gen-map (fal FLUX tile) → uploaded colour
// tile, converted once at build time by materials.ts exactly like an uploaded image (C2 fix —
// no client-side pre-conversion here either; see onReliefFilePicked's doc above). (A fal
// depth-model second stage used to run here; removed — depth reports scene distance, which is
// flat on a straight-on material photo, so it was a wasted paid call. See
// server/utils/scene3dRelief.ts.) Explicit button ONLY — this costs money and takes seconds, so
// it must never fire on a parameter change. Same object-id-keyed spinner/error shape as the
// upload above (reliefUploading/reliefUploadError), so a busy or failed generation on one
// object can't bleed onto another after reselecting.
const reliefGenOpen = ref(false)
const reliefGenPrompt = ref('')
const reliefGenBusy = ref<string | null>(null)
const reliefGenError = reactive<Record<string, boolean>>({})
function toggleReliefGen() {
  reliefGenOpen.value = !reliefGenOpen.value
}
/** fal's colour tile comes back as a remote CDN URL; inpaint.uploadDataUrl (like the
 *  file-picker path above) needs a data: URL to hand ComfyUI's /upload/image, so fetch
 *  it client-side and re-encode before handing it off. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(blob)
  })
}
async function generateReliefFromPrompt() {
  const target = selected.value
  const prompt = reliefGenPrompt.value.trim()
  if (!target || target.kind === 'light' || !prompt || reliefGenBusy.value) return
  reliefGenBusy.value = target.id
  delete reliefGenError[target.id]
  delete reliefFlatWarning[target.id]
  try {
    const r = await $fetch<{ imageUrl: string, seed: number }>('/api/scene3d/gen-map', {
      method: 'POST',
      body: { prompt },
    })
    const res = await fetch(r.imageUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const rawUrl = await blobToDataUrl(await res.blob())
    const filename = await inpaint.uploadDataUrl(rawUrl, `scene3d_relief_gen_${props.nodeId}`)
    delete texLoadError[filename]
    if (!target.material.relief) target.material.relief = { source: 'image', scale: MATERIAL_DEFAULTS.reliefScale }
    target.material.relief.source = 'image'
    target.material.relief.image = filename
    reliefGenOpen.value = false
    reliefGenPrompt.value = ''
    try {
      reliefFlatWarning[target.id] = (await measureReliefFlatness(rawUrl)) < RELIEF_FLAT_THRESHOLD
    } catch { /* measurement is advisory only — a failure here must not fail the generation */ }
  } catch (err) {
    console.error('[scene3d-studio] gen-map failed', err)
    reliefGenError[target.id] = true
  } finally {
    if (reliefGenBusy.value === target.id) reliefGenBusy.value = null
  }
}

// Numeric transform fields (per-axis) — position/scale stored & shown raw, rotation
// stored in radians but edited in degrees. Setters replace the whole array so the
// deep doc watcher fires (engine syncs); gizmo drags mutate the same arrays, so the
// computed getters re-read and the inputs update — two-way, no extra wiring.
const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
/** Apply one transform-row edit across the WHOLE selection, as the spec's
 *  multi-select rule requires: the typed number lands on the primary and every
 *  other selected object shifts by the same DELTA. Absolute fan-out would stack
 *  three selected objects on one another the moment you typed a position, which
 *  is why `axisDeltaWrites` (unit-tested in scene3d-hierarchy.unit.spec.ts) owns
 *  the arithmetic — including the rule that a selected object inside another
 *  selected object does NOT get the delta, since its ancestor already carries it
 *  through the scene graph.
 *
 *  Without this, the panel was incoherent: with three objects selected, Color
 *  changed three, Position X changed one, and the gizmo moved all three.
 *
 *  `v` is in DOC units — the rotation row converts to radians before calling. */
function writeAxis(prop: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, v: number): void {
  for (const { id, value } of axisDeltaWrites(doc.objects, selectedIds.value, prop, axis, v)) {
    const o = doc.objects.find((x) => x.id === id)
    if (!o) continue
    // Replace the whole array so the deep doc watcher fires (engine syncs) —
    // same reason the single-selection path always did.
    const next = [...o[prop]] as [number, number, number]
    next[axis] = value
    o[prop] = next
  }
}
function axisField(prop: 'position' | 'scale', axis: 0 | 1 | 2) {
  return computed<number>({
    get: () => selected.value?.[prop][axis] ?? (prop === 'scale' ? 1 : 0),
    set: (v) => {
      if (!selected.value || !Number.isFinite(v)) return
      writeAxis(prop, axis, v)
    },
  })
}
function rotField(axis: 0 | 1 | 2) {
  return computed<number>({
    get: () => (selected.value ? selected.value.rotation[axis] * RAD2DEG : 0),
    set: (v) => {
      if (!selected.value || !Number.isFinite(v)) return
      writeAxis('rotation', axis, v * DEG2RAD)
    },
  })
}
const posX = axisField('position', 0), posY = axisField('position', 1), posZ = axisField('position', 2)
const rotX = rotField(0), rotY = rotField(1), rotZ = rotField(2)
const sclX = axisField('scale', 0), sclY = axisField('scale', 1), sclZ = axisField('scale', 2)

// Geometry params for the selected primitive. Reads resolve through the schema
// (stored value clamped, else the spec default); writes create the params bag on
// first touch. Always iterate PRIMITIVE_PARAMS[kind] — paramValue throws on a key
// the kind doesn't declare. Toggles store 0 | 1 so params stays a flat number map.
function paramOf(key: string): number {
  const o = selected.value
  return o && o.kind === 'primitive' ? paramValue(o.primitive, o.params, key) : 0
}
function setParam(key: string, v: number): void {
  const o = selected.value
  if (!o || o.kind !== 'primitive') return
  if (!o.params) o.params = {}
  o.params[key] = v
}

// Modifier bag: same schema-driven read/write shape as geometry params, but the
// specs are shared across every primitive kind rather than keyed by kind.
function modOf(key: string): number {
  const o = selected.value
  return o && o.kind === 'primitive' ? modifierValue(o.modifiers, key) : 0
}
function setMod(key: string, v: number): void {
  const o = selected.value
  if (!o || o.kind !== 'primitive') return
  if (!o.modifiers) o.modifiers = {}
  o.modifiers[key] = v
}
const modSpec = (key: string) => MODIFIER_SPECS.find((s) => s.key === key)!
// Option controls store the option's index; the segmented control speaks labels.
function optionOf(key: string): string {
  const spec = modSpec(key)
  return spec.options![Math.round(modOf(key))] ?? spec.options![0]!
}
function setOption(key: string, label: string): void {
  const i = modSpec(key).options!.indexOf(label)
  if (i >= 0) setMod(key, i)
}
const cloneMode = computed(() => Math.round(modOf('cloneMode')))
// Modifier controls, grouped for the panel. The Cloner lives in its own
// top-level section (below), so it is not one of these groups.
const MODIFIER_GROUPS = computed(() => [
  { label: 'Taper', keys: ['taper', 'taperAxis'] },
  { label: 'Twist', keys: ['twist', 'twistAxis'] },
  { label: 'Bend', keys: ['bend', 'bendAxis'] },
  { label: 'Noise', keys: ['noise', 'noiseScale', 'noiseSeed'] },
  { label: 'Jitter', keys: ['jitter', 'jitterMode', 'jitterSeed'] },
])
// Cloner keys: the placement controls are swapped by mode, so this is computed
// rather than a static list. Grid drops `cloneCount` entirely — its three axis
// counts replace it (and `totalClones` reads them instead).
const CLONER_KEYS = computed(() => {
  if (cloneMode.value === 1) return ['cloneCount', 'cloneMode', 'cloneRadius', 'cloneAxis']
  if (cloneMode.value === 2)
    return [
      'cloneMode',
      'cloneCountX', 'cloneCountY', 'cloneCountZ',
      'cloneSpacingX', 'cloneSpacingY', 'cloneSpacingZ',
    ]
  return ['cloneCount', 'cloneMode', 'cloneOffsetX', 'cloneOffsetY', 'cloneOffsetZ']
})
// Step transforms accumulate across copies and apply in every mode, so they sit
// below the mode-specific controls under their own micro-label.
const CLONER_STEP_KEYS = ['cloneStepRotX', 'cloneStepRotY', 'cloneStepRotZ', 'cloneStepScale']

// Cost readout. The philosophy here is disclose, don't clamp: detail and counts
// are user-visible slider values, so silently reducing them would make the
// readout lie. Instead the totals are shown while dragging.
// Measured on this machine: rebuilds are synchronous and roughly linear in
// vertex count — ~390ms/tick at 274k, ~1080ms at 1.1M. The warning has to land
// before the drag starts hurting, so it trips at 200k rather than at the point
// where it is already unusable.
const AMBER_VERTS = 200_000
const cloneCost = computed(() => {
  const o = selected.value
  if (!o || o.kind !== 'primitive') return null
  const copies = totalClones(o.modifiers)
  if (copies <= 1) return null
  const verts = baseVertexCountFor(o.primitive, o.params, o.modifiers, o.content) * copies
  return { copies, verts, heavy: verts > AMBER_VERTS }
})
// Heavy-drag deferral. A rebuild at 300k+ verts blocks the main thread long
// enough that the slider itself stops tracking the pointer, so for the duration
// of a drag on a heavy object the engine skips geometry rebuilds and catches up
// once on release. Nothing is clamped: the released value is what gets built.
// Heaviness is sampled once at pointerdown so a drag never changes mode midway.
const deferringGeometry = ref(false)
function onControlsPointerDown() {
  if (!engine || deferringGeometry.value || !cloneCost.value?.heavy) return
  deferringGeometry.value = true
  engine.deferGeometry = true
}
// On window, not the panel: the pointer routinely leaves the controls column
// mid-drag, and a missed release would leave the viewport permanently stale.
function onGeometryDragRelease() {
  if (!deferringGeometry.value) return
  deferringGeometry.value = false
  if (!engine) return
  engine.deferGeometry = false
  engine.syncFromDoc(doc) // one rebuild, at the final slider values
}

/** Compact vertex figure: 4200 → "4.2k", 331_000 → "331k", 1_060_000 → "1.1M". */
function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Size = scale expressed in scene units. Base dimensions come from the geometry
// itself (rebuilt from the doc, so they follow parameter changes — a fatter torus
// tube is a bigger torus). GLBs fall back to the engine's measured bounds.
// Measuring a primitive means BUILDING it (with the cloner — an array really is
// wider), so this is as expensive as the engine's own rebuild. It therefore
// freezes with the mesh during a deferred drag: the Size row shows what is on
// screen, and both catch up together on release.
let lastBaseSize: [number, number, number] = [1, 1, 1]
const baseSize = computed<[number, number, number]>(() => {
  void fontGen.value // font loads aren't reactive; this re-measures when a font resolves
  const o = selected.value
  if (!o) return [1, 1, 1]
  if (deferringGeometry.value) return lastBaseSize
  lastBaseSize = o.kind === 'primitive'
    ? baseSizeFor(o.primitive, o.params, o.modifiers, o.content)
    : engine?.baseSizeOf(o.id) ?? [1, 1, 1]
  return lastBaseSize
})
function sizeAxis(i: 0 | 1 | 2, scl: { value: number }) {
  return computed<number>({
    get: () => Math.round(scl.value * (baseSize.value[i] || 1) * 100) / 100,
    set: (v: number) => {
      const base = baseSize.value[i] || 1
      if (!Number.isFinite(v) || !base) return
      scl.value = v / base
    },
  })
}
// The Geometry panel's rows, straight from the schema — never a hand-written list.
const geoSpecs = computed(() => {
  const o = selected.value
  return o && o.kind === 'primitive' ? PRIMITIVE_PARAMS[o.primitive] : []
})

// ── Text primitive controls (Geometry panel, above the schema-driven sliders) ──
// Not schema-driven like the sliders above: `content` only exists on `text`
// objects and holds a string + a font URL, not a numeric param.
const selectedText = computed<PrimitiveObject | null>(() => {
  const o = selected.value
  return o && o.kind === 'primitive' && o.primitive === 'text' ? o : null
})
const textValue = computed<string>({
  get: () => selectedText.value?.content?.text ?? '',
  set: (v) => {
    const o = selectedText.value
    if (!o) return
    if (o.content) o.content.text = v
    else o.content = { text: v, font: DEFAULT_FONT_URL } // defensive: content is always seeded by createPrimitive
  },
})
// FontPicker emits a discriminated payload (mirrors SpaceTypeSurface's usage):
// a pinned pick is one of our local AVAILABLE_FONTS urls (today's behavior,
// unchanged); a google pick writes the bare `google:Family` token — no weight
// suffix on first pick, matching the plan.
function onFontPick(payload: { kind: 'google'; family: string } | { kind: 'pinned'; value: string }) {
  const o = selectedText.value
  if (!o) return
  let font: string
  if (payload.kind === 'pinned') {
    font = payload.value
  } else {
    // Weights are per-family: re-picking the SAME family (e.g. from the
    // catalog dropdown after already having chosen a weight) keeps that
    // weight instead of silently resetting it to the default; picking a
    // DIFFERENT family still resets, since its weight has no meaning there.
    const existing = parseGoogleFontValue(o.content?.font ?? '')
    font = existing && existing.family === payload.family && existing.weight !== undefined
      ? `google:${payload.family}@${existing.weight}`
      : `google:${payload.family}`
  }
  if (o.content) o.content.font = font
  else o.content = { text: 'Text', font }
}
// Local copy of the Google Fonts catalog, used only to resolve the selected
// family's available weights for the Weight select below (FontPicker owns its
// own copy for the searchable dropdown; loadGoogleCatalog is module-cached so
// this is a no-op refetch, same pattern as SpaceTypeSurface).
const fontCatalog = ref<GoogleFont[]>([])
loadGoogleCatalog().then((c) => { fontCatalog.value = c })
// Non-null only when the selected text's font is a `google:` token — drives
// the Weight select's visibility (hidden for local fonts).
const selectedGoogleFont = computed(() => {
  const font = selectedText.value?.content?.font
  return font ? parseGoogleFontValue(font) : null
})
// The family's catalog weights, or [400] until the catalog resolves (or if
// the family isn't found in it).
const fontWeightOptions = computed<string[]>(() => {
  const parsed = selectedGoogleFont.value
  if (!parsed) return []
  const entry = fontCatalog.value.find((f) => f.family === parsed.family)
  const weights = entry?.weights.length ? entry.weights : [400]
  return weights.map(String)
})
const fontWeight = computed<string>({
  get: () => String(selectedGoogleFont.value?.weight ?? 400),
  set: (w) => {
    const o = selectedText.value
    const parsed = selectedGoogleFont.value
    if (!o || !parsed) return
    const font = `google:${parsed.family}@${w}`
    if (o.content) o.content.font = font
    else o.content = { text: 'Text', font }
  },
})
// Inline load-error line, mirroring the GLB list's glbError convention but kept
// local (no id-keyed map needed — only the selected object's font is shown).
// loadFont caches by url, so switching back to an already-resolved font never
// re-fetches; a resolved load always clears the flag.
const fontError = ref(false)
// Bumped on a successful load so `baseSize` (which peeks the font cache but
// isn't reactive to it) re-measures once the font resolves.
const fontGen = ref(0)
watch(() => selectedText.value?.content?.font, (url) => {
  fontError.value = false
  if (!url) return
  loadFont(url).then(() => {
    // The selection (or its font) may have moved on while this load was in
    // flight — a stale success must not clear today's error or refresh a
    // mesh that isn't even showing this font anymore.
    if (selectedText.value?.content?.font !== url) return
    fontError.value = false
    fontGen.value++
    // loadFont doesn't cache failures, so a failed load never gets retried by
    // the engine itself — this watch firing again (on an unrelated doc edit,
    // a Retry click, whatever) IS the retry. On success, heal the mesh that's
    // been stuck on the placeholder cube since the failure, not just the Size
    // row (fontGen only re-measures; it doesn't touch geometry).
    engine?.refreshTextGeometry(url)
  }).catch(() => {
    if (selectedText.value?.content?.font !== url) return
    fontError.value = true
  })
}, { immediate: true })
const sizeX = sizeAxis(0, sclX)
const sizeY = sizeAxis(1, sclY)
const sizeZ = sizeAxis(2, sclZ)

// ── Engine lifecycle ──────────────────────────────────────────────────────────
const canvasEl = ref<HTMLCanvasElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
let engine: SceneEngine | null = null
let interaction: SceneInteraction | null = null
let raf = 0
let ro: ResizeObserver | null = null
// Wall-clock start of this surface's rAF loop — a shaderFill field's animation clock runs off
// elapsed real time, same as ShapeStudioSurface.vue's `mountedAt` (Scene3D's own playhead
// governs object motion, not this). Set once in onMounted, read every loop() tick.
let scene3dMountedAt = 0
// Frozen-field hint, mirroring ShapeStudioSurface.vue's frozenFieldCount exactly (same design
// rule: no silent caps on any surface). Reset to 0 whenever the doc has no shaderFill material
// so it doesn't show a stale count after switching a material away from shaderFill.
const shaderFrozenCount = ref(0)

// Light View HTML labels: a chip per light (color dot + name + live intensity)
// at its projected screen position. Reprojected every frame in the rAF loop
// since the camera orbits — cheap for the ≤MAX_LIGHTS-sized array.
const lightLabels = ref<{ id: string; name: string; intensity: number; color: string; x: number; y: number; show: boolean }[]>([])
function updateLightLabels() {
  if (!lightView.value || !engine || !viewportEl.value) { lightLabels.value = []; return }
  const rect = viewportEl.value.getBoundingClientRect()
  const w = rect.width, h = rect.height
  lightLabels.value = doc.objects.filter((o) => o.kind === 'light').map((o) => {
    const light = o as LightObject
    const ndc = new THREE.Vector3(...light.position).project(engine!.camera)
    return {
      id: light.id,
      name: light.name,
      intensity: light.intensity,
      color: light.color,
      x: (ndc.x * 0.5 + 0.5) * w,
      y: (-ndc.y * 0.5 + 0.5) * h,
      show: ndc.z < 1,
    }
  })
}

onMounted(() => {
  webglOk.value = detectWebGL()
  if (!webglOk.value || !canvasEl.value || !viewportEl.value) return
  const rect = viewportEl.value.getBoundingClientRect()
  engine = new SceneEngine(canvasEl.value, rect.width, rect.height)
  engine.applyCameraFromDoc(doc)
  interaction = new SceneInteraction(engine, viewportEl.value, {
    onSelect: (id, additive) => {
      // A miss with a modifier held leaves the selection alone. Shift-clicking is
      // how you BUILD a multi-selection, so one shift-click that lands a few
      // pixels off an object must not throw away everything picked up so far —
      // the gesture that adds must never be the gesture that wipes.
      if (!id) { if (!additive) selectedIds.value = []; return }
      toggleSelected(id, additive)
    },
    onTransform: (id, t) => {
      const o = doc.objects.find((x) => x.id === id)
      if (o) { o.position = t.position; o.rotation = t.rotation; o.scale = t.scale }
    },
    onTransformMany: (entries) => {
      // Entries carry WORLD transforms (under the gizmo pivot a root's local TRS
      // is pivot-relative), so rebaseMany turns each one back into a local under
      // its real parent — the doc stores LOCAL transforms. The parents-before-
      // children ordering that a parent+descendant selection depends on lives in
      // there too, where it is unit-tested (scene3d-hierarchy.unit.spec.ts).
      for (const { id, t } of rebaseMany(doc.objects, entries)) {
        const o = doc.objects.find((x) => x.id === id)
        if (o) { o.position = t.position; o.rotation = t.rotation; o.scale = t.scale }
      }
    },
    // The drag suppressed every syncFromDoc it triggered (see the doc watcher);
    // run the one that was owed now that the roots are back in the scene, so
    // they land under their real parents again.
    onPivotDragEnd: () => { engine?.syncFromDoc(doc) },
  })
  interaction.orbit.target.set(...doc.camera.target)
  engine.syncFromDoc(doc)
  scene3dMountedAt = performance.now()
  // Catalog fetch is cached module-wide (catalog.ts) — a no-op if another already-open
  // studio surface pulled it this page load. Priming it here (rather than waiting for the
  // material panel's ShaderFillEditor to mount) means it's usually already warm by the time
  // a user picks the shaderFill material type. Sync reads (getEffectSync, inside resolveField)
  // work before this resolves too; they just render nothing until it does.
  fetchShaderFxCatalog().catch(() => { /* ShaderFillEditor's own picker falls back to the raw id and offers a Retry */ })
  // Warm-up every restored GLB so a scene loaded from scene_state surfaces load
  // failures in the list too (the engine's own load leaves an empty group silently;
  // addGlb/duplicateObject only warm the ones created this session).
  for (const o of doc.objects) {
    if (o.kind === 'glb') loadGlb(o.url).catch(() => { glbError[o.id] = true })
  }
  const loop = () => {
    // Only touch the shader-field refresh path when the doc actually has a shaderFill
    // material — see SceneEngine.refreshShaderFields's doc: this isn't needed for correctness
    // (an owner with no shaderFill materials is a cheap no-op inside refreshSceneShaderFields),
    // it's so an ordinary scene's frame loop never starts paying new per-frame cost it never
    // paid before.
    if (engine) {
      const hasShaderFill = sceneHasShaderFill(doc)
      if (hasShaderFill) engine.refreshShaderFields((performance.now() - scene3dMountedAt) / 1000)
      shaderFrozenCount.value = hasShaderFill ? engine.frozenFieldCount : 0
    }
    if (playing.value && engine) {
      const dur = doc.motion.duration
      const elapsed = (performance.now() - playStart) / 1000
      playhead.value = doc.motion.loop ? elapsed % dur : Math.min(elapsed, dur)
      const t01 = dur > 0 ? playhead.value / dur : 0
      const { doc: sampled, opacities } = applyMotionToDoc(doc, t01)
      // Lock orbit while the camera is animated so it can't fight the motion.
      // Must go through setCameraLocked, not a direct `orbit.enabled =` write:
      // a gizmo drag also owns that flag (SceneInteraction's dragging-changed
      // listener), and this runs every frame — a raw per-frame write here would
      // silently stomp the gizmo's lock the instant a drag starts (this exact
      // bug shipped once already; see interaction.ts's orbitShouldBeEnabled).
      interaction?.setCameraLocked(!!(doc.camera.motion && doc.camera.motion.preset !== 'none'))
      // Refuse gizmo grabs for as long as playback runs. Dragging against a
      // per-frame re-sync from a SAMPLED doc is incoherent for a single
      // selection and destructive for a multi-selection: the sync tears the
      // roots out of the pivot, which keeps emitting, so each object's
      // motion-sampled world transform gets written back as its BASE local and
      // the animation's offsets are baked in permanently.
      interaction?.setPlaybackLocked(true)
      // Second line of defence for the one way a drag can still be live here —
      // playback started (keyboard, or the button on a second pointer) with the
      // pointer already down, which the lock above deliberately does not
      // interrupt. Sampled state is throwaway; the pivot's roots are not.
      if (!interaction?.pivotDragActive) engine.syncFromDoc(sampled)
      engine.applyCameraFromDoc(sampled)
      engine.applyObjectOpacities(opacities)
      interaction?.orbit.update()
      engine.render()
      updateLightLabels()
    } else {
      interaction?.setCameraLocked(false)
      interaction?.setPlaybackLocked(false)
      interaction?.orbit.update()
      engine?.render()
      updateLightLabels()
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  ro = new ResizeObserver(() => {
    const r = viewportEl.value?.getBoundingClientRect()
    if (r && engine) engine.setSize(r.width, r.height)
  })
  ro.observe(viewportEl.value)
  // Capture phase: StudioModalShell (a child, so its onMounted runs first)
  // registered its Escape→close keydown on window (bubble) BEFORE ours, and
  // stopPropagation can't stop already-queued same-node listeners. Capturing
  // lets Esc-with-selection deselect first and suppress the shell's close via
  // stopImmediatePropagation + preventDefault (the shell also early-returns on
  // e.defaultPrevented). Same technique as StudioColor's popover.
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerup', onGeometryDragRelease)
  window.addEventListener('pointercancel', onGeometryDragRelease)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerup', onGeometryDragRelease)
  window.removeEventListener('pointercancel', onGeometryDragRelease)
  window.removeEventListener('pointerdown', onPrimMenuOutside, true)
  window.removeEventListener('pointerdown', onLightMenuOutside, true)
  window.removeEventListener('pointerdown', onGenMenuOutside, true)
  cancelAnimationFrame(raf)
  ro?.disconnect()
  interaction?.dispose()
  engine?.dispose()
})

// Any edit re-dirties and clears a stale bake failure so the amber "unbaked
// changes" indicator isn't masked by an old red "Bake failed — retry".
watch(doc, () => {
  dirty.value = true
  bakeError.value = ''
  // A multi-selection drag has the selected roots temporarily re-parented under
  // the gizmo pivot, and syncObject re-parents EVERY root to its doc parent on
  // every sync — syncing here (from the drag's own per-move doc writes) would
  // rip them out of the pivot after the first delta and leave the rest of the
  // gesture moving nothing. The viewport is already live during that window
  // (the pivot moves the roots directly), and onPivotDragEnd runs the sync.
  if (!interaction?.pivotDragActive) engine?.syncFromDoc(doc)
  scheduleHistory()
}, { deep: true })
// Watches the whole ORDERED selection, not just the primary: a modifier-click
// that only extends the list leaves `selectedId` unchanged but still has to
// rebuild the gizmo around a pivot.
watch(selectedIds, (ids) => {
  // ANY light in the selection suppresses the scale gizmo, not just the primary:
  // LightObject's scale is never read, so scaling a light in a mixed selection
  // writes a number nothing honours — and a light that resists scaling alone but
  // accepts it next to a cube is the more confusing of the two behaviours.
  const anyLight = ids.some((id) => doc.objects.find((o) => o.id === id)?.kind === 'light')
  interaction?.selectMany([...ids], anyLight)
  engine?.setSelected(ids[ids.length - 1] ?? null)
  // Minor 4 fix (final review): an open Generate panel stays bound to whichever object it was
  // opened for via reliefGenBusy/reliefGenPrompt's shared id-keying, but its BUTTON just reads
  // `selected.id` at click time — leaving the panel open across a reselect would bill the
  // newly-selected object for a prompt the user wrote while looking at a different one. The
  // prompt text itself carrying over is harmless (Minor, not Critical); only the panel's
  // visibility needs resetting.
  reliefGenOpen.value = false
})
watch(snap, (s) => interaction?.setSnap(s))
watch(lightView, (on) => engine?.setLightView(on))

// ── Undo / redo ──────────────────────────────────────────────────────────────
// History is a stack of serialized doc snapshots, coalesced by a short debounce so
// a whole slider drag collapses into ONE step. A restore mutates the doc in place;
// `restoring` suppresses the history push that its own change would otherwise queue.
const undoStack: string[] = []
const redoStack: string[] = []
let lastSnapshot = serializeDoc(doc)
let restoring = false
let histTimer: ReturnType<typeof setTimeout> | null = null
function commitHistory() {
  histTimer = null
  const cur = serializeDoc(doc)
  if (cur === lastSnapshot) return
  undoStack.push(lastSnapshot)
  if (undoStack.length > 100) undoStack.shift()
  redoStack.length = 0
  lastSnapshot = cur
}
function scheduleHistory() {
  if (restoring) return
  if (histTimer) clearTimeout(histTimer)
  histTimer = setTimeout(commitHistory, 350)
}
function applySnapshot(snap: string) {
  const p = parseDoc(snap)
  restoring = true
  doc.objects = p.objects
  doc.camera = p.camera
  doc.lighting = p.lighting
  doc.background = p.background
  doc.showFloor = p.showFloor
  doc.post = p.post
  doc.output = p.output
  doc.motion = p.motion
  // A restored snapshot may not contain the selected object anymore.
  selectedIds.value = selectedIds.value.filter((id) => doc.objects.some((o) => o.id === id))
  lastSnapshot = snap
  nextTick(() => { restoring = false })
}
function undo() {
  if (histTimer) { clearTimeout(histTimer); commitHistory() } // flush a pending in-progress edit first
  const snap = undoStack.pop()
  if (snap === undefined) return
  redoStack.push(serializeDoc(doc))
  applySnapshot(snap)
}
function redo() {
  const snap = redoStack.pop()
  if (snap === undefined) return
  undoStack.push(serializeDoc(doc))
  applySnapshot(snap)
}

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const inField = tag === 'INPUT' || tag === 'TEXTAREA' || !!(e.target as HTMLElement)?.isContentEditable
  // Own Cmd/Ctrl+Z (Shift = redo; Cmd+Y = redo) so the canvas graph's undo doesn't
  // fire while the studio is open. Skipped while typing in a field (its native undo wins).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !inField) {
    const k = e.key.toLowerCase()
    if (k === 'z') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) redo(); else undo(); return }
    if (k === 'y') { e.preventDefault(); e.stopImmediatePropagation(); redo(); return }
    // Cmd/Ctrl+G groups, +Shift ungroups. Handled here (not down by Escape, as
    // the brief first sketched) because the very next line unconditionally
    // returns on ANY modified key — a branch placed after it would never run.
    if (k === 'g') { e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return }
  }
  // Never hijack other modified chords (Cmd+R reload, Ctrl/Alt combos).
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (inField) return
  // (No W/E/R mode shortcuts — the combined gizmo moves/rotates/scales at once.)
  if (e.key === 'Escape') {
    // Open primitive/light/generate menu owns Esc: close it, never the modal.
    if (primMenuOpen.value || lightMenuOpen.value || genOpen.value) {
      e.preventDefault()
      e.stopImmediatePropagation()
      primMenuOpen.value = false
      lightMenuOpen.value = false
      genOpen.value = false
      return
    }
    // An open StudioColor popover owns Escape (its own capture listener closes
    // it); it registered after us so we'd fire first — yield to it.
    if (document.querySelector('[data-studio-color-pop]')) return
    const primary = selectedId.value ? doc.objects.find((o) => o.id === selectedId.value) : null
    if (primary?.parentId) {
      // Step up to the containing group rather than clearing — the only
      // traversal in the model, and the way a group gets selected from the
      // viewport (clicking always picks the child).
      e.preventDefault()
      e.stopImmediatePropagation()
      selectedIds.value = [primary.parentId]
      return
    }
    if (selectedId.value) {
      // Deselect only: preventDefault + stopImmediatePropagation keep the
      // shell's window keydown (and anything else) from closing the modal.
      e.preventDefault()
      e.stopImmediatePropagation()
      selectedId.value = null
    }
    // No selection → fall through untouched; the shell's Escape closes.
  }
  else if (e.key === 'Backspace' && selectedIds.value.length) {
    // Snapshot before looping: removeObject mutates selectedIds as it goes (a
    // cascade can remove a later id in this same batch as somebody else's
    // descendant), and iterating the live ref would skip or re-visit entries.
    for (const id of [...selectedIds.value]) removeObject(id)
  }
}

// ── Grouping ──────────────────────────────────────────────────────────────────
/** Wrap the selection in a new group. The group is parented wherever the
 *  PRIMARY selection lives, so grouping inside an existing group nests rather
 *  than escaping to the root. */
function groupSelection() {
  const ids = selectedIds.value
  if (ids.length < 2) return
  const primary = doc.objects.find((o) => o.id === ids[ids.length - 1]!)
  const group = createGroup(doc.objects)
  if (primary?.parentId) group.parentId = primary.parentId
  doc.objects = groupObjects(doc.objects, ids, group)
  selectedIds.value = [group.id]
}

/** Dissolve every selected group, freeing its children in place. The actual
 *  dissolve-and-collect logic lives in `ungroupMany` (hierarchy.ts) — it has to
 *  handle a selection containing both a group and its own descendant group,
 *  which isn't safe to get right in a component with no unit test coverage. */
function ungroupSelection() {
  const groupIds = selectedObjects.value.filter((o) => o.kind === 'group').map((o) => o.id)
  if (!groupIds.length) return
  const { objects, freedIds } = ungroupMany(doc.objects, groupIds)
  doc.objects = objects
  selectedIds.value = freedIds
}

// ── Object operations ─────────────────────────────────────────────────────────
function addPrimitive(kind: PrimitiveKind) {
  const o = createPrimitive(kind, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
}
// Scenes render every light as a real Three.js light — an unbounded count would
// tank frame time, so the UI caps additions rather than letting the doc silently
// grow into something the engine chokes on.
const MAX_LIGHTS = 8
function addLight(kind: LightKind) {
  const count = doc.objects.filter((o) => o.kind === 'light').length
  if (count >= MAX_LIGHTS) { console.warn(`[scene3d-studio] light cap reached (${MAX_LIGHTS})`); return }
  const o = createLight(kind, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
  lightMenuOpen.value = false
  // First light in the scene: auto-enter Light View so its widget is visible
  // immediately instead of leaving the user to find the toggle.
  if (doc.objects.filter((obj) => obj.kind === 'light').length === 1) lightView.value = true
}
function addGlb(url: string) {
  if (!url) return
  const o = createGlbObject(url, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
  // Eager warm-up so the object list can surface a load failure (the engine's own
  // load silently leaves an empty group; this catch flags it in the list).
  loadGlb(url).catch(() => { glbError[o.id] = true })
}
function removeObject(id: string) {
  // A group's children are independent doc objects; deleting only the group
  // would leave them orphaned at the root — visually "escaping" the delete.
  const doomed = new Set([id, ...descendantIds(doc.objects, id)])
  doc.objects = doc.objects.filter((o) => !doomed.has(o.id))
  // Remove every doomed id from the selection without going through the replace-setter,
  // which would discard any other selected objects when multi-selection is active.
  selectedIds.value = selectedIds.value.filter((x) => !doomed.has(x))
  for (const gone of doomed) delete glbError[gone]
}
// C3 fix (final review): `{ ...src.material }` is a SHALLOW copy — `material.relief` (and
// `material.relief.spec`/`material.shader`, same hazard) is a nested object, so the shallow
// copy left both objects' materials pointing at the SAME `relief` object. Duplicate a box with
// relief, drag the copy's Depth, and the ORIGINAL's Depth moved too — it looked like it fixed
// itself after save+reload only because serializeDoc writes two independent copies to JSON.
// duplicateObject's very next line already deep-clones params/modifiers with a comment about
// exactly this hazard; material just never got the same treatment.
function cloneMaterial(mat: SceneMaterial): SceneMaterial {
  const copy: SceneMaterial = { ...mat }
  if (mat.relief) {
    copy.relief = { ...mat.relief }
    if (mat.relief.spec) copy.relief.spec = JSON.parse(JSON.stringify(mat.relief.spec))
  }
  if (mat.shader) copy.shader = JSON.parse(JSON.stringify(mat.shader))
  return copy
}
// Shared body behind duplicateObject's single-object copy AND its subtree clones
// below (Task 9) — pulled out so both call sites share one deep-clone instead of
// growing two copies of the material/params/modifiers hazard the comment above
// documents. Position/rotation/scale/parentId travel VERBATIM (not offset) —
// duplicateObject applies its own +0.5 nudge only to the object the user
// actually clicked "duplicate" on; a descendant's local TRS is relative to its
// (also-cloned) parent, so leaving it untouched is what keeps the whole
// subtree's shape intact.
//
// `visible`/`content`/`motion` are carried too (review fix, post-Task-9):
// `Object.assign` here used to only reach position/rotation/scale/material/
// params/modifiers/materialOverride/light fields/parentId, silently dropping
// SceneObjectBase.visible and PrimitiveObject.content along with ObjectMotion
// entirely. Duplicating a hidden object made the copy visible (nobody asked
// for that), and duplicating an animated Text object — now routine since
// subtree duplication clones every descendant — produced N children that all
// read the default "Text" with no animation at all. `content` and `motion`
// are both nested objects (motion's `in`/`out`.ease.cps is itself an array
// inside a nested TransitionSpec), so both are JSON-round-tripped rather than
// spread one level — a shallow `{ ...src.motion }` would still alias `cps`
// between original and copy, exactly the `material.relief` aliasing class
// cloneMaterial's C3 fix already exists to prevent, just reintroduced here.
//
// Switches on `src.kind` (rather than an if/else-if chain) so the `default`
// branch can assign `src` to a `never` — the moment SceneObject grows a fifth
// member, that assignment stops compiling instead of silently falling through
// to whichever branch happened to be last. That silent-fallthrough failure
// mode is exactly what bit 'group': it used to be the ternary's unconditional
// `else`, so a GroupObject was constructed via `createLight(src.light, ...)` —
// a type error (`src.light` doesn't exist on GroupObject) that also described
// a real runtime bug, fabricating a light-shaped object instead of a group.
// `existing` defaults to the live doc for the single-object call site, but the
// subtree loop below passes an ACCUMULATING array instead — createPrimitive/
// createGlbObject/createLight/createGroup number the copy's name against
// `existing`, and cloning several children before any of them are pushed to
// `doc.objects` would otherwise have every clone numbered against the same
// stale snapshot, handing two of them the identical next-available name.
function cloneObject(src: SceneObject, existing: SceneObject[] = doc.objects): SceneObject {
  let copy: SceneObject
  switch (src.kind) {
    case 'primitive': copy = createPrimitive(src.primitive, existing); break
    case 'glb': copy = createGlbObject(src.url, existing); break
    case 'light': copy = createLight(src.light, existing); break
    case 'group': copy = createGroup(existing); break
    default: {
      const _exhaustive: never = src
      throw new Error(`cloneObject: unhandled kind ${(_exhaustive as SceneObject).kind}`)
    }
  }
  Object.assign(copy, {
    position: [...src.position], rotation: [...src.rotation], scale: [...src.scale], material: cloneMaterial(src.material),
    visible: src.visible,
    // Geometry params travel with the copy, cloned not aliased — a shared bag
    // would make both objects' shapes move together on any later edit.
    ...(src.kind === 'primitive' && src.params ? { params: { ...src.params } } : {}),
    ...(src.kind === 'primitive' && src.modifiers ? { modifiers: { ...src.modifiers } } : {}),
    // Deep-copied: a shallow `{ ...src.content }` is safe today (both fields
    // are strings) but this is the same nested-bag shape as params/modifiers
    // above, so it's cloned the same defensive way rather than relying on
    // "happens to be flat right now."
    ...(src.kind === 'primitive' && src.content ? { content: { ...src.content } } : {}),
    // motion is a nested structure (loop/in/out, and in/out's ease can itself
    // carry a `cps` array) — JSON round-tripped rather than spread, matching
    // cloneMaterial's own treatment of relief.spec/shader for the identical
    // aliasing reason.
    ...(src.motion ? { motion: JSON.parse(JSON.stringify(src.motion)) } : {}),
    ...(src.kind === 'glb' && src.materialOverride ? { materialOverride: true } : {}),
    // Light fields likewise travel with the copy — same discriminated-union
    // shape as material/params above, just flat on the object instead of nested.
    ...(src.kind === 'light' ? {
      color: src.color, intensity: src.intensity, distance: src.distance, decay: src.decay,
      angle: src.angle, penumbra: src.penumbra, width: src.width, height: src.height, castShadow: src.castShadow,
    } : {}),
    // Preserve containment: a duplicate should land beside its source, not
    // escape to the root — the same "escaping" failure mode Step 1's delete
    // cascade guards against, just for duplicate instead of delete. (Not in the
    // task's original pseudocode, but duplicateObject predates `parentId` and
    // this is exactly the kind of gap "make per-object operations
    // hierarchy-aware" calls out — see task report.)
    ...(src.parentId ? { parentId: src.parentId } : {}),
  })
  return copy
}
function duplicateObject(id: string) {
  const src = doc.objects.find((o) => o.id === id)
  if (!src) return
  // Clone the whole subtree (a group with no children copied is an empty box)
  // via hierarchy.ts's cloneSubtree, which owns the id-remapping and the
  // batch-numbering-scope accumulation — see its doc comment for the naming
  // collision that scope-accumulation exists to prevent. `cloneObject` is
  // passed straight through as the `make` factory.
  const clones = cloneSubtree(doc.objects, id, (s, existing) => cloneObject(s, existing))
  const copy = clones[0]!
  copy.position = [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5]
  doc.objects.push(...clones)
  selectedId.value = copy.id
  // Same eager warm-up as addGlb so a failing GLB source flags the duplicate too.
  if (copy.kind === 'glb') loadGlb(copy.url).catch(() => { glbError[copy.id] = true })
}

// Retry an errored GLB: clear the flag, then recreate the object with the same
// fields but a fresh id so the engine (which diffs syncFromDoc by id) treats it as
// a new source and actually reloads — reusing the id would be a no-op. loadGlb never
// caches failures, so the re-fetch genuinely retries.
function retryGlb(id: string) {
  const idx = doc.objects.findIndex((o) => o.id === id)
  const o = doc.objects[idx]
  if (!o || o.kind !== 'glb') return
  delete glbError[id]
  const fresh = createGlbObject(o.url, doc.objects.filter((x) => x.id !== id))
  Object.assign(fresh, {
    name: o.name, visible: o.visible,
    position: [...o.position], rotation: [...o.rotation], scale: [...o.scale],
    material: { ...o.material },
    ...(o.materialOverride ? { materialOverride: true } : {}),
    // Carry the parent across too, for the same reason `cloneObject` does: the
    // retried object's TRS is a LOCAL transform under that parent. Dropping
    // parentId here re-reads those same numbers as world coordinates, so a
    // failed GLB inside a group at [5,0,0] jumps to the origin and leaves the
    // group the instant the user clicks Retry.
    ...(o.parentId ? { parentId: o.parentId } : {}),
  })
  doc.objects.splice(idx, 1, fresh)
  if (selectedId.value === id) selectedId.value = fresh.id
  loadGlb(fresh.url).catch(() => { glbError[fresh.id] = true })
}

// Upload a local .glb into ComfyUI's input dir, then add it as a scene object. The
// server's /upload/image endpoint accepts arbitrary files; the returned filename is
// served back same-origin via /view (so loadGlb's fetch works without CORS).
function triggerGlbUpload() { glbFileInput.value?.click() }
async function onGlbFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // reset so re-picking the same file re-fires change
  if (!file) return
  uploadError.value = ''
  if (file.size > GLB_SIZE_CAP_BYTES) {
    uploadError.value = `File too large — ${Math.round(GLB_SIZE_CAP_BYTES / (1024 * 1024))}MB max.`
    return
  }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('image', file, file.name) // ComfyUI's field name is "image" for any file
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload ${res.status}`)
    const filename = (await res.json())?.name || file.name
    addGlb(`/view?${new URLSearchParams({ filename, type: 'input' }).toString()}`)
  } catch (err) {
    console.error('[scene3d-studio] glb upload failed', err)
    uploadError.value = 'Upload failed — try again.'
  } finally {
    uploading.value = false
  }
}

// Both the file picker and the paste box funnel through here — everything past
// parsing (split/merge choice, group naming, selection) is identical either way,
// so the second entry point costs almost nothing.
async function importSvgSource(source: string, name: string) {
  svgError.value = null
  let paths: SvgLeafPath[]
  try {
    const res = await svgToLeafPaths(source, { targetWidth: 1.5 })
    paths = await outlineStrokes(res.paths)
  } catch {
    svgError.value = 'Could not read that SVG.'
    return
  }
  if (!paths.length) {
    svgError.value = 'That SVG had nothing to extrude — no filled or stroked paths.'
    return
  }
  if (paths.length > SVG_SPLIT_THRESHOLD) { svgPending.value = { paths, name }; return }
  commitSvg(paths, name, false)
}

function commitSvg(paths: SvgLeafPath[], name: string, merged: boolean) {
  const objs = buildSvgObjects(paths, doc.objects, {
    name, merged, ...(selected.value?.parentId ? { parentId: selected.value.parentId } : {}),
  })
  doc.objects.push(...objs)
  selectedIds.value = [objs[0]!.id] // buildSvgObjects returns the group first
  svgPending.value = null
  svgPasteOpen.value = false
  svgPasteText.value = ''
}

async function onSvgFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // reset so re-picking the same file re-fires change
  if (!file) return
  const base = file.name.replace(/\.svg$/i, '') || 'SVG'
  await importSvgSource(await file.text(), base)
}

// Persist the live viewport camera into the doc so it serializes with the scene
// (reopening restores your exact view). Called before every serialize/bake — the
// bake itself renders from the live engine camera, so what you see is what exports.
function syncDocCamera() {
  if (!engine || !interaction) return
  doc.camera.position = engine.camera.position.toArray() as [number, number, number]
  doc.camera.target = interaction.orbit.target.toArray() as [number, number, number]
  doc.camera.fov = engine.camera.fov
}

// ── Bake ──────────────────────────────────────────────────────────────────────
const inpaint = useInpaint()
async function bake(): Promise<void> {
  if (!engine || baking.value) return
  baking.value = true
  bakeError.value = ''
  syncDocCamera() // persist the live view before it serializes into scene_state
  // Light View swaps in clay + widgets for the live preview, but export must
  // always render the real materials — force it off for the passes, then
  // restore whatever the user had regardless of success or failure.
  const wasLightView = lightView.value
  if (wasLightView) engine?.setLightView(false)
  try {
    try {
      // Item 5 (final review): pass the SAME live elapsed-seconds value the rAF loop
      // above feeds `engine.refreshShaderFields` (`(performance.now() - scene3dMountedAt)
      // / 1000`), so a still export bakes a shaderFill field at whatever moment the live
      // view was actually showing, not always frozen at its very first frame (t=0).
      const passes = await renderPasses(engine, doc, (performance.now() - scene3dMountedAt) / 1000)
      // Upload all three passes BEFORE touching any widget so a mid-bake failure
      // never leaves a mismatched pass set (e.g. fresh beauty + stale depth).
      const [beauty, depth, normal] = await Promise.all([
        inpaint.uploadDataUrl(passes.beauty, `scene3d_beauty_${props.nodeId}`),
        inpaint.uploadDataUrl(passes.depth, `scene3d_depth_${props.nodeId}`),
        inpaint.uploadDataUrl(passes.normal, `scene3d_normal_${props.nodeId}`),
      ])
      setWidget('beauty_image', beauty)
      setWidget('depth_image', depth)
      setWidget('normal_image', normal)
      setWidget('scene_state', serializeDoc(doc))
      dirty.value = false
    } finally {
      if (wasLightView) engine?.setLightView(true)
    }
  } catch (e) {
    // Swallow (no rethrow): the Bake button gets an inline error instead of an
    // unhandled rejection, and onClose's auto-bake can never block closing.
    console.error('[scene3d-studio] bake failed', e)
    bakeError.value = 'Bake failed — retry'
  } finally {
    baking.value = false
  }
}

// Save: persist the scene document only (no render/upload). Lets the user
// checkpoint work and keep editing; the node's output images are unchanged
// until an explicit Export.
function saveScene() {
  syncDocCamera()
  setWidget('scene_state', serializeDoc(doc))
  savedFlash.value = true
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => { savedFlash.value = false }, 1500)
}

// Export to Canvas: bake the three passes onto the node's outputs, drop the
// beauty render onto the canvas as an Image node (wired from the beauty output,
// like the other studios' "generate" flow), then return to the canvas. Stays
// open on failure so the inline error is visible.
async function exportToCanvas() {
  await bake()
  if (bakeError.value) return
  const beauty = widgetStr('beauty_image')
  if (beauty) {
    window.dispatchEvent(new CustomEvent('sailor:scene3dStudioOutput', {
      detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: beauty } },
    }))
  }
  emit('close')
}

// Esc / ✕: persist the scene (implicit save) and leave — export is explicit now,
// so closing never re-renders.
function onClose() {
  syncDocCamera()
  setWidget('scene_state', serializeDoc(doc))
  emit('close')
}
</script>

<template>
  <StudioModalShell title="3D Studio" @close="onClose">
    <template #preview>
      <div ref="viewportEl" class="relative h-full w-full min-h-0">
        <canvas v-if="webglOk" ref="canvasEl" class="h-full w-full" />
        <div v-else class="flex h-full items-center justify-center text-sm text-white/50">
          WebGL is unavailable — the 3D Studio needs a WebGL-capable browser.
        </div>
        <!-- Overlay toolbar: snap only — the combined gizmo (Spline-style) moves,
             rotates, and scales without mode switching, so no mode buttons.
             (No "Set camera" either — the export always renders your live view.)
             @pointerdown.stop: these overlays sit inside the viewport element that
             OrbitControls binds to. Without this, a press on a button bubbles to
             OrbitControls, which setPointerCapture()s the pointer on the viewport —
             retargeting pointerup/click to the viewport so the button's @click never
             fires (and a stray orbit-drag starts). Stop it at the overlay boundary. -->
        <div v-if="webglOk" class="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/60 p-1.5 backdrop-blur" @pointerdown.stop>
          <button type="button" class="rounded px-2 py-1 text-xs"
            :class="snap ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'"
            @click="snap = !snap">snap</button>
          <button type="button" class="flex items-center gap-1 rounded px-2 py-1 text-xs"
            :class="lightView ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'"
            @click="lightView = !lightView"><Lightbulb class="size-3.5" /> Light</button>
        </div>

        <!-- Shader-fill frozen hint: mirrors ShapeStudioSurface.vue's — no silent caps on any
             surface. Opposite corner from the snap/light toolbar so the two never collide. -->
        <div v-if="webglOk && shaderFrozenCount > 0"
             class="pointer-events-none absolute right-3 top-3 rounded-md border border-amber-400/30 bg-black/70 px-3 py-2 text-[11px] text-amber-200/90">
          {{ shaderFrozenCount }} shader fill{{ shaderFrozenCount > 1 ? 's' : '' }} frozen — too many live shader
          fields at once (limit {{ LIVE_FIELD_CEILING }}). Remove a shader fill for full motion.
        </div>

        <!-- Motion timeline panel: docks full-width over the add-toolbar's spot in
             Motion mode (a timeline wants horizontal room — the narrow right panel
             cramped it). Transport header + the band tracks, video-editor style. -->
        <div v-if="webglOk && activeTab === 'motion'"
             class="absolute inset-x-3 bottom-3 z-10 rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-2.5 shadow-lg" @pointerdown.stop>
          <div class="mb-2 flex items-center gap-2 text-[11px] text-white/60">
            <StudioButton @click="togglePlay">{{ playing ? 'Pause' : 'Play' }}</StudioButton>
            <span class="tabular-nums">{{ playhead.toFixed(2) }} / {{ doc.motion.duration.toFixed(1) }}s</span>
            <div class="flex-1"></div>
            <StudioButton @click="exportVideo">Export video</StudioButton>
          </div>
          <div v-if="motionOn" class="max-h-[32vh] overflow-y-auto pr-1">
            <Scene3DMotionTimeline :doc="doc" :selected-id="selectedId" :playhead="playhead"
              @select="(id: string) => (selectedId = id)" />
          </div>
          <p v-else class="py-1.5 text-center text-[11px] text-white/40">Turn on “Animate scene” to add motion.</p>
        </div>

        <!-- Bottom add-toolbar (Grid editor pill style): + Primitive menu · Upload GLB.
             Hidden in Motion mode — the timeline panel above takes its place. -->
        <div v-if="webglOk && activeTab !== 'motion'" class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10" data-prim-menu @pointerdown.stop>
          <p v-if="uploadError" class="mb-2 text-center text-[11px] text-red-400/90">{{ uploadError }}</p>
          <div class="relative flex items-center gap-1 rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-1.5 shadow-lg">
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors cursor-pointer"
              :class="primMenuOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              @click="lightMenuOpen = false; genOpen = false; primMenuOpen = !primMenuOpen"
            >
              <Plus class="size-4" /> Primitive
            </button>
            <div class="mx-0.5 h-5 w-px bg-white/10" />
            <button
              type="button"
              :disabled="uploading"
              class="flex h-8 items-center gap-1.5 rounded px-2.5 text-[12px] text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-50"
              @click="triggerGlbUpload"
            >
              <Loader2 v-if="uploading" class="size-4 animate-spin" />
              <Upload v-else class="size-4" />
              {{ uploading ? 'Uploading…' : 'Upload GLB' }}
            </button>
            <div class="mx-0.5 h-5 w-px bg-white/10" />
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors cursor-pointer"
              :class="lightMenuOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              @click="primMenuOpen = false; genOpen = false; lightMenuOpen = !lightMenuOpen"
            >
              <Lightbulb class="size-4" /> Light
            </button>
            <div class="mx-0.5 h-5 w-px bg-white/10" />
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors cursor-pointer"
              :class="genOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              @click="primMenuOpen = false; lightMenuOpen = false; genOpen = !genOpen"
            >
              <Sparkles class="size-4" /> Generate
            </button>

            <!-- Primitive menu: popup card above the button (Brand-panel mechanic) -->
            <div
              v-if="primMenuOpen"
              class="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-lg border border-white/10 bg-[#161616] p-2 shadow-2xl"
            >
              <div v-for="group in PRIM_GROUPS" :key="group.label" class="mb-1.5 last:mb-0">
                <p class="mb-1 px-1 text-[10px] uppercase tracking-[0.12em] text-white/35">{{ group.label }}</p>
                <div class="grid grid-cols-2 gap-0.5">
                  <button
                    v-for="p in group.kinds"
                    :key="p.kind"
                    type="button"
                    class="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                    @click="pickPrimitive(p.kind)"
                  >
                    <component :is="p.icon" class="size-4 shrink-0 opacity-70" />
                    {{ p.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Light menu: same popup mechanic as the primitive menu, right-aligned
                 above its trigger since it's the last button in the pill. -->
            <div
              v-if="lightMenuOpen"
              class="absolute bottom-full right-0 z-30 mb-2 w-36 rounded-lg border border-white/10 bg-[#161616] p-2 shadow-2xl"
            >
              <button
                v-for="k in LIGHT_KINDS"
                :key="k"
                type="button"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                @click="addLight(k)"
              >
                <Lightbulb class="size-4 shrink-0 opacity-70" />
                {{ LIGHT_KIND_LABELS[k] }}
              </button>
            </div>

            <!-- Generate menu: text → image review → make 3D. Same popup mechanic
                 as the primitive/light menus, right-aligned above its trigger. -->
            <div
              v-if="genOpen"
              class="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-lg border border-white/10 bg-[#161616] p-3 shadow-2xl"
            >
              <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Generate 3D model</p>
              <textarea
                v-model="genPrompt"
                rows="2"
                placeholder="A weathered leather armchair…"
                class="mb-2 w-full resize-none rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 outline-none focus:border-white/25"
              />
              <StudioButton
                variant="primary"
                :disabled="!genPrompt.trim() || genStage === 'image' || genStage === 'making'"
                @click="genImage"
              >
                <span class="flex items-center gap-1.5">
                  <Loader2 v-if="genStage === 'image'" class="h-3.5 w-3.5 animate-spin" />
                  <Sparkles v-else class="h-3.5 w-3.5" />
                  {{ genStage === 'image' ? 'Generating image…' : 'Generate' }}
                </span>
              </StudioButton>

              <template v-if="genImageUrl && genStage !== 'idle'">
                <div class="mt-3 space-y-2">
                  <img :src="genImageUrl!" alt="" class="h-32 w-full rounded object-cover" />
                  <div class="flex items-center gap-1.5">
                    <StudioButton variant="secondary" :disabled="genStage === 'making'" @click="reroll">
                      <span class="flex items-center gap-1.5"><Shuffle class="h-3.5 w-3.5" /> Re-roll</span>
                    </StudioButton>
                  </div>
                  <div>
                    <label class="mb-1 block text-[11px] text-white/55">3D model</label>
                    <select
                      v-model="gen3dModel"
                      class="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white/85 outline-none focus:border-white/25"
                    >
                      <option v-for="m in GEN_3D_MODELS" :key="m" :value="m">{{ m }}</option>
                    </select>
                  </div>
                  <label class="flex cursor-pointer items-center justify-between text-[11px] text-white/55">
                    <span>Textured</span>
                    <input v-model="genTextured" type="checkbox" class="h-3.5 w-3.5 accent-white/70" />
                  </label>
                  <StudioButton variant="primary" :disabled="genStage === 'making'" @click="make3d">
                    <span class="flex items-center gap-1.5">
                      <Loader2 v-if="genStage === 'making'" class="h-3.5 w-3.5 animate-spin" />
                      <Box v-else class="h-3.5 w-3.5" />
                      {{ genStage === 'making' ? 'Making 3D…' : 'Make 3D' }}
                    </span>
                  </StudioButton>
                </div>
              </template>

              <p v-if="genStage === 'error' && genError" class="mt-2 text-[11px] text-red-400/90">{{ genError }}</p>
            </div>
          </div>
        </div>

        <!-- Light View labels: HTML chips (color dot + name + live intensity) at
             each light's projected screen position. pointer-events-none root so
             the viewport stays orbit/select-driven; @pointerdown.stop guards the
             (empty) root anyway, matching the other overlay containers here. -->
        <div class="pointer-events-none absolute inset-0" @pointerdown.stop>
          <div
            v-for="l in lightLabels"
            :key="l.id"
            v-show="l.show"
            class="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
            :style="{ left: l.x + 'px', top: l.y + 'px' }"
          >
            <span class="size-2 shrink-0 rounded-full" :style="{ background: l.color }" />
            {{ l.name }} · {{ l.intensity.toFixed(1) }}
          </div>
        </div>
      </div>
    </template>

    <!-- Object list: its own dedicated panel (like Smart Layout / Frame), separate
         from the inspector column at right. -->
    <template #aside>
      <div class="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.04]">
        <div class="shrink-0 px-3 py-2.5 text-[11px] font-medium text-white/50">Objects</div>
        <div v-if="canGroup || canUngroup" class="flex shrink-0 gap-1 px-2 pb-2">
          <StudioButton v-if="canGroup" @click="groupSelection">
            <span class="flex items-center gap-1.5"><Group class="h-3.5 w-3.5" /> Group</span>
          </StudioButton>
          <StudioButton v-if="canUngroup" @click="ungroupSelection">
            <span class="flex items-center gap-1.5"><Ungroup class="h-3.5 w-3.5" /> Ungroup</span>
          </StudioButton>
        </div>
        <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          <div v-if="!doc.objects.length" class="px-1 text-xs leading-relaxed text-white/40">
            Empty scene — add a primitive or upload a GLB from the toolbar below<span v-if="wiredGlbUrl">, or import the wired model</span>.
          </div>
          <Scene3DObjectRow v-for="o in rootObjectList" :key="o.id"
            :object="o" :objects="doc.objects" :selected-ids="selectedIds" :glb-error="glbError" :depth="0"
            @select="toggleSelected"
            @remove="removeObject"
            @duplicate="duplicateObject"
            @retry="retryGlb"
            @toggle-visible="(id) => { const found = doc.objects.find((x) => x.id === id); if (found) found.visible = !found.visible }" />
        </div>
        <div v-if="wiredGlbUrl" class="shrink-0 border-t border-white/[0.08] p-2">
          <StudioButton @click="addGlb(wiredGlbUrl)">
            <span class="flex items-center gap-1.5"><Plus class="h-3.5 w-3.5" /> Import wired model</span>
          </StudioButton>
        </div>
        <input ref="glbFileInput" type="file" accept=".glb,model/gltf-binary" class="hidden" @change="onGlbFilePicked" />

        <!-- SVG import: same file-import spot as the GLB upload above. Two doors
             (file picker, paste box) into one importSvgSource — see its comment. -->
        <div class="shrink-0 space-y-1 border-t border-white/[0.08] p-2">
          <StudioButton @click="svgFileInput?.click()">
            <span class="flex items-center gap-1.5"><Upload class="h-3.5 w-3.5" /> Import SVG</span>
          </StudioButton>
          <StudioButton @click="svgPasteOpen = !svgPasteOpen">
            <span class="flex items-center gap-1.5"><ClipboardPaste class="h-3.5 w-3.5" /> Paste SVG</span>
          </StudioButton>
          <div v-if="svgPasteOpen" class="space-y-1">
            <textarea v-model="svgPasteText" rows="4" placeholder="Paste <svg>…</svg>"
              class="w-full rounded bg-black/30 p-2 text-[11px] text-white/80" @pointerdown.stop />
            <StudioButton :disabled="!svgPasteText.trim()" @click="importSvgSource(svgPasteText, 'SVG')">Add</StudioButton>
          </div>
          <p v-if="svgError" class="text-[11px] text-red-400">{{ svgError }}</p>
          <div v-if="svgPending" class="space-y-1 rounded border border-white/15 p-2 text-[11px]">
            <p class="text-white/70">This SVG has {{ svgPending.paths.length }} paths.</p>
            <div class="flex gap-1">
              <StudioButton @click="commitSvg(svgPending.paths, svgPending.name, false)">Separate objects</StudioButton>
              <StudioButton @click="commitSvg(svgPending.paths, svgPending.name, true)">One merged object</StudioButton>
            </div>
          </div>
          <input ref="svgFileInput" type="file" accept=".svg,image/svg+xml" class="hidden" @change="onSvgFilePicked" />
        </div>
      </div>
    </template>

    <template #controls>
      <div class="mb-2 flex gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
        <button type="button" class="nodrag flex-1 rounded px-2 py-1"
                :class="activeTab === 'build' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="activeTab = 'build'">Build</button>
        <button type="button" class="nodrag flex-1 rounded px-2 py-1"
                :class="activeTab === 'motion' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="activeTab = 'motion'">Motion</button>
      </div>

      <template v-if="activeTab === 'build'">
      <!-- Multi-selection indicator. Every row below reads the PRIMARY's value
           but writes to the whole selection, so without this the panel looks
           like an ordinary single-object inspector right up until one edit
           changes N objects. Action blue is Sailor's only accent. -->
      <div v-if="selectedIds.length > 1" data-testid="multi-select-badge"
           class="mb-2 flex items-center gap-1.5 rounded-lg border border-[#4f8cff]/35 bg-[#4f8cff]/10 px-2.5 py-1.5 text-[11px] text-[#4f8cff]">
        <Boxes class="h-3.5 w-3.5 shrink-0" />
        <span class="tabular-nums">{{ selectedIds.length }} objects selected</span>
        <span class="ml-auto shrink-0 text-[10px] text-[#4f8cff]/60">edits apply to all</span>
      </div>
      <StudioSection v-if="selected" title="Transform" @pointerdown.capture="onControlsPointerDown">
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Position</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="posX" type="number" step="0.1" aria-label="Position X" class="studio-num" />
            <input v-model.number="posY" type="number" step="0.1" aria-label="Position Y" class="studio-num" />
            <input v-model.number="posZ" type="number" step="0.1" aria-label="Position Z" class="studio-num" />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Rotation°</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="rotX" type="number" step="1" aria-label="Rotation X" class="studio-num" />
            <input v-model.number="rotY" type="number" step="1" aria-label="Rotation Y" class="studio-num" />
            <input v-model.number="rotZ" type="number" step="1" aria-label="Rotation Z" class="studio-num" />
          </div>
        </div>
        <div v-if="selected && !selectedIsLight">
          <label class="mb-1 block text-[11px] text-white/55">Size</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="sizeX" type="number" step="0.05" aria-label="Size X" class="studio-num" />
            <input v-model.number="sizeY" type="number" step="0.05" aria-label="Size Y" class="studio-num" />
            <input v-model.number="sizeZ" type="number" step="0.05" aria-label="Size Z" class="studio-num" />
          </div>
        </div>
      </StudioSection>

      <StudioSection v-if="selectedIsPrimitive" title="Geometry" @pointerdown.capture="onControlsPointerDown">
        <!-- Text controls: not schema-driven (content is {text?,font?}, only
             carried by `text` objects) — sit above the generated sliders. -->
        <div v-if="selectedText" class="space-y-3 pt-1">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Text</label>
            <input v-model="textValue" type="text" aria-label="Text content" class="studio-num" style="text-align: left" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Font</label>
            <FontPicker
              :model-value="fontDisplayName(selectedText?.content?.font ?? DEFAULT_FONT_URL)"
              :pinned="AVAILABLE_FONTS.map((f) => ({ label: f.label, value: f.url }))"
              :show-variable-toggle="false"
              @select="onFontPick"
            />
            <p v-if="fontError" class="mt-1 text-[11px] text-red-400">Font failed to load — showing placeholder.</p>
          </div>
          <div v-if="selectedGoogleFont">
            <label class="mb-1 block text-[11px] text-white/55">Weight</label>
            <StudioSelect v-model="fontWeight" :options="fontWeightOptions" />
          </div>
        </div>

        <!-- Geometry: a peer of the material sub-groups (plain details, no card
             chrome), but open by default — these are the shape's primary knobs. -->
        <div v-if="geoSpecs.length" class="space-y-3 pt-1">
          <template v-for="spec in geoSpecs" :key="spec.key">
            <label
              v-if="spec.control === 'toggle'"
              class="flex cursor-pointer items-center justify-between text-[11px] text-white/55"
              :title="spec.hint"
            >
              <span>{{ spec.label }}</span>
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-white/70"
                :checked="paramOf(spec.key) > 0.5"
                @change="setParam(spec.key, ($event.target as HTMLInputElement).checked ? 1 : 0)"
              />
            </label>
            <StudioSlider
              v-else
              :model-value="paramOf(spec.key)"
              :label="spec.label"
              :hint="spec.hint"
              :min="spec.min"
              :max="spec.max"
              :step="spec.step"
              @update:model-value="(v: number) => setParam(spec.key, v)"
            />
          </template>
        </div>

        <!-- Modifiers: a peer of Geometry (same plain details, no card chrome),
             collapsed by default — these deform the built geometry. -->
        <details v-if="selectedIsPrimitive" class="group">
          <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Modifiers</summary>
          <div class="space-y-3 pt-1">
            <StudioSlider
              :model-value="modOf('subdivide')"
              :label="modSpec('subdivide').label"
              :hint="modSpec('subdivide').hint"
              :min="modSpec('subdivide').min"
              :max="modSpec('subdivide').max"
              :step="modSpec('subdivide').step"
              @update:model-value="(v: number) => setMod('subdivide', v)"
            />
            <div v-for="group in MODIFIER_GROUPS" :key="group.label" class="space-y-2">
              <div class="pt-1 text-[10px] uppercase tracking-[0.12em] text-white/25">{{ group.label }}</div>
              <template v-for="key in group.keys" :key="key">
                <div v-if="modSpec(key).control === 'options'">
                  <label class="mb-1 block text-[11px] text-white/55" :title="modSpec(key).hint">{{ modSpec(key).label }}</label>
                  <StudioSegmented
                    :model-value="optionOf(key)"
                    :options="modSpec(key).options!"
                    @update:model-value="(v: string) => setOption(key, v)"
                  />
                </div>
                <StudioSlider
                  v-else
                  :model-value="modOf(key)"
                  :label="modSpec(key).label"
                  :hint="modSpec(key).hint"
                  :min="modSpec(key).min"
                  :max="modSpec(key).max"
                  :step="modSpec(key).step"
                  @update:model-value="(v: number) => setMod(key, v)"
                />
              </template>
            </div>
          </div>
        </details>

        <!-- Cloner: a peer of Geometry and Modifiers, not a group inside them —
             this section is meant to grow. Flat list, collapsed by default. -->
        <details v-if="selectedIsPrimitive" class="group">
          <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Cloner</summary>
          <div class="space-y-3 pt-1">
            <template v-for="key in CLONER_KEYS" :key="key">
              <div v-if="modSpec(key).control === 'options'">
                <label class="mb-1 block text-[11px] text-white/55" :title="modSpec(key).hint">{{ modSpec(key).label }}</label>
                <StudioSegmented
                  :model-value="optionOf(key)"
                  :options="modSpec(key).options!"
                  @update:model-value="(v: string) => setOption(key, v)"
                />
              </div>
              <StudioSlider
                v-else
                :model-value="modOf(key)"
                :label="modSpec(key).label"
                :hint="modSpec(key).hint"
                :min="modSpec(key).min"
                :max="modSpec(key).max"
                :step="modSpec(key).step"
                @update:model-value="(v: number) => setMod(key, v)"
              />
            </template>

            <!-- Step transforms accumulate across copies in every mode, so they
                 are their own block below the mode-specific placement controls. -->
            <div class="space-y-2">
              <div class="pt-1 text-[10px] uppercase tracking-[0.12em] text-white/25">Step</div>
              <StudioSlider
                v-for="key in CLONER_STEP_KEYS"
                :key="key"
                :model-value="modOf(key)"
                :label="modSpec(key).label"
                :hint="modSpec(key).hint"
                :min="modSpec(key).min"
                :max="modSpec(key).max"
                :step="modSpec(key).step"
                @update:model-value="(v: number) => setMod(key, v)"
              />
            </div>

            <!-- Cost disclosure: what this clone set actually costs, live while
                 dragging. Amber past the point where rebuilds start to hitch. -->
            <div
              v-if="cloneCost"
              class="pt-0.5 text-[10px] tabular-nums"
              :class="cloneCost.heavy ? 'text-amber-400/80' : 'text-white/35'"
            >
              {{ cloneCost.copies }} copies · ~{{ compactCount(cloneCost.verts) }} verts<template v-if="deferringGeometry"> · updates on release</template>
            </div>
          </div>
        </details>
      </StudioSection>

      <StudioSection v-if="selected && (selectedIsPrimitive || selectedIsGlb)" title="Material" @pointerdown.capture="onControlsPointerDown">
        <!-- Imported models keep their baked materials until overridden. -->
        <div v-if="selectedIsGlb" class="flex items-center justify-between">
          <div>
            <span class="text-[11px] text-white/55">Override materials</span>
            <p class="text-[10px] text-white/35">Replace the model's built-in look</p>
          </div>
          <StudioSwitch v-model="matOverride" />
        </div>

        <div v-if="matEditable">
          <label class="mb-1 block text-[11px] text-white/55">Material</label>
          <StudioSelect v-model="matType" :options="MATERIAL_TYPES" />
        </div>

        <!-- physical surface: standard + glass share the grouped panel -->
        <template v-if="matEditable && (matType === 'standard' || matType === 'glass')">
          <div>
            <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Surface</p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Color</span>
                <StudioColor v-model="matColor" />
              </div>
              <StudioSlider v-model="matRoughness" label="Roughness" hint="How matte or glossy the surface is" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matMetalness" label="Metalness" hint="Blends between plastic-like and metal reflections" :min="0" :max="1" :step="0.01" />
            </div>
          </div>

          <details class="group">
            <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Coat &amp; sheen</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matClearcoat" label="Clearcoat" hint="Adds a thin glossy varnish layer on top" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matClearcoatRoughness" label="Coat roughness" hint="How blurred or sharp that varnish coat looks" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matSheen" label="Sheen" hint="Soft fabric-like edge highlight" :min="0" :max="1" :step="0.01" />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Sheen colour</span>
                <StudioColor v-model="matSheenColor" />
              </div>
            </div>
          </details>

          <details class="group">
            <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Glow</summary>
            <div class="space-y-3 pt-1">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Emissive</span>
                <StudioColor v-model="matEmissive" />
              </div>
              <StudioSlider v-model="matEmissiveIntensity" label="Intensity" hint="How brightly the material glows on its own" :min="0" :max="5" :step="0.05" />
            </div>
          </details>

          <details class="group" :open="transparencyOpen" @toggle="transparencyOpen = ($event.target as HTMLDetailsElement).open">
            <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Transparency</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matOpacity" label="Opacity" hint="How see-through the whole surface is" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matTransmission" label="Transmission" hint="Lets light pass through, like glass" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matIor" label="IOR" hint="How strongly light bends passing through" :min="1" :max="2.33" :step="0.01" />
              <StudioSlider v-model="matThickness" label="Thickness" hint="How solid the glass feels as light travels in" :min="0" :max="2" :step="0.05" />
              <StudioSlider v-model="matDispersion" label="Dispersion" hint="Splits refracted light into rainbow fringes" :min="0" :max="5" :step="0.05" />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Attenuation</span>
                <StudioColor v-model="matAttenuationColor" />
              </div>
              <StudioSlider v-model="matAttenuationDistance" label="Attenuation dist" hint="How deep light travels before tinting (0 = off)" :min="0" :max="10" :step="0.1" />
            </div>
          </details>

          <details class="group">
            <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Iridescence</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matIridescence" label="Amount" hint="Strength of the soap-bubble colour shift" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matIridescenceIOR" label="IOR" hint="Tunes which colours the bubble film shifts to" :min="1" :max="2.33" :step="0.01" />
            </div>
          </details>

          <details class="group">
            <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Reflection</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matEnvMapIntensity" label="Intensity" hint="How strongly reflections from the surroundings show" :min="0" :max="3" :step="0.05" />
            </div>
          </details>
        </template>

        <!-- phong: retro-CG specular/shininess model, kept deliberately distinct from the
             PBR types (standard/glass) — see MaterialType's doc in config.ts. No roughness/
             metalness here; Phong has no such properties. -->
        <template v-else-if="matEditable && matType === 'phong'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matShininess" label="Shininess" hint="How tight and glossy the highlight is — higher is sharper" :min="0" :max="200" :step="1" />
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Specular</span>
            <StudioColor v-model="matSpecular" />
          </div>
        </template>

        <!-- toon -->
        <template v-else-if="matEditable && matType === 'toon'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matToonSteps" label="Steps" hint="Number of flat cel-shading bands" :min="2" :max="5" :step="1" />
        </template>

        <!-- matcap -->
        <template v-else-if="matEditable && matType === 'matcap'">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Matcap</label>
            <div class="flex items-center gap-1.5">
              <button v-for="id in MATCAP_IDS" :key="id" type="button" :title="id"
                class="size-8 overflow-hidden rounded-full border transition-colors"
                :class="matMatcap === id ? 'border-white/80' : 'border-white/15 hover:border-white/40'"
                @click="matMatcap = id">
                <img :src="matcapThumb(id)" class="size-full" alt="" />
              </button>
            </div>
          </div>
        </template>

        <!-- fresnel -->
        <template v-else-if="matEditable && matType === 'fresnel'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Rim colour</span>
            <StudioColor v-model="matFresnelColor" />
          </div>
          <StudioSlider v-model="matFresnelPower" label="Power" hint="How tightly the rim glow hugs the edges" :min="1" :max="8" :step="0.1" />
        </template>

        <!-- gradient -->
        <template v-else-if="matEditable && matType === 'gradient'">
          <StudioGradientRamp v-model="matGradientStops" />
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Type</label>
            <StudioSegmented v-model="matGradientType" :options="['linear', 'radial']" />
          </div>
          <div v-if="matGradientType === 'linear'" class="space-y-3">
            <div>
              <label class="mb-1 block text-[11px] text-white/55">Direction</label>
              <div class="flex items-center gap-1.5">
                <button v-for="ax in (['x', 'y', 'z'] as const)" :key="ax" type="button"
                  class="flex-1 rounded border px-2 py-1 text-[11px] uppercase transition-colors"
                  :class="isAxisPreset(ax) ? 'border-white/70 bg-white/[0.10] text-white' : 'border-white/[0.10] bg-white/[0.04] text-white/55 hover:text-white/85'"
                  @click="applyAxisPreset(ax)">{{ ax }}</button>
              </div>
            </div>
            <StudioSlider v-model="matGradientYaw" label="Yaw" hint="Ramp direction around the Y axis" :min="0" :max="360" :step="1" />
            <StudioSlider v-model="matGradientPitch" label="Pitch" hint="Ramp direction elevation, up or down" :min="-90" :max="90" :step="1" />
          </div>
          <StudioSlider v-model="matGradientOffset" label="Offset" hint="Slides the ramp along its direction" :min="-1" :max="1" :step="0.01" />
          <StudioSlider v-model="matGradientSpread" label="Spread" hint="Compresses (&lt;1) or stretches (&gt;1) the ramp" :min="0.1" :max="3" :step="0.01" />
          <!-- Faceted/prismatic shading needs the per-face extent attributes only
               primitive geometry bakes; imported GLB meshes always ramp smooth. -->
          <div v-if="selectedIsPrimitive">
            <label class="mb-1 block text-[11px] text-white/55">Shading</label>
            <StudioSegmented v-model="matGradientShading" :options="['smooth', 'faceted', 'prismatic']" />
          </div>
        </template>

        <!-- image -->
        <template v-else-if="matEditable && matType === 'image'">
          <input ref="texFileInput" type="file" accept="image/*" class="hidden" @change="onTexFilePicked" />
          <div class="flex items-center gap-2">
            <img v-if="selected.material.image" class="size-12 rounded object-cover"
              :src="texViewUrl(selected.material.image)" alt="" />
            <StudioButton :disabled="texUploading === selected.id" @click="triggerTexUpload">
              <span class="flex items-center gap-1.5">
                <Loader2 v-if="texUploading === selected.id" class="h-3.5 w-3.5 animate-spin" />
                <Upload v-else class="h-3.5 w-3.5" />
                {{ texUploading === selected.id ? 'Uploading…' : selected.material.image ? 'Replace image' : 'Upload image' }}
              </span>
            </StudioButton>
          </div>
          <p v-if="texUploadError[selected.id] || (selected.material.image && texLoadError[selected.material.image])"
            class="text-[11px] text-red-400/90">texture failed</p>
          <StudioSlider v-model="matRoughness" label="Roughness" hint="How matte or glossy the surface is" :min="0" :max="1" :step="0.01" />
          <StudioSlider v-model="matMetalness" label="Metalness" hint="Blends between plastic-like and metal reflections" :min="0" :max="1" :step="0.01" />
        </template>

        <!-- shaderFill: a catalog effect wrapped onto the mesh's own UVs (object anchor only —
             frame anchor is out of scope here entirely; materials.ts never reads `shader.anchor`,
             see SceneMaterial.shader's doc in config.ts). The full editor (effect picker + derived
             per-effect params + speed + nested input fill) — same component Space Type, Shape
             Studio and the Compositor mount, bound straight to `matShader` since its ShaderSpec
             shape already matches this editor's `modelValue` prop 1:1. `show-anchor="false"`
             hides the anchor toggle rather than leaving it offered-but-inert (the bug Shape
             Studio currently has). -->
        <template v-else-if="matEditable && matType === 'shaderFill'">
          <ShaderFillEditor v-model="matShader" :show-anchor="false" />
          <div class="flex items-center justify-between">
            <div>
              <span class="text-[11px] text-white/55">Unlit</span>
              <p class="text-[10px] text-white/35">Glows flat instead of being shaded by scene lights</p>
            </div>
            <StudioSwitch v-model="matUnlit" />
          </div>
          <StudioSlider v-if="!matUnlit" v-model="matRoughness" label="Roughness" hint="How matte or glossy the surface is" :min="0" :max="1" :step="0.01" />
          <StudioSlider v-if="!matUnlit" v-model="matMetalness" label="Metalness" hint="Blends between plastic-like and metal reflections" :min="0" :max="1" :step="0.01" />
        </template>

        <!-- Surface relief: a grayscale height texture perturbing .bumpMap, orthogonal to
             material type — sits after the per-type chain so it applies to every branch above.
             NB: never call this a "normal pass" in copy — passes.ts already emits a
             screen-space `normal` G-buffer for ControlNet, a completely different thing. -->
        <div v-if="matEditable">
          <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Surface relief</p>
          <p v-if="!reliefAvailable" class="text-[10px] text-white/35">
            Unlit materials have no lighting to catch relief. Turn off Unlit to use it.
          </p>
          <div v-else class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-white/55">Relief</span>
              <div class="flex items-center gap-1.5">
                <button type="button"
                  class="flex-1 rounded border px-2 py-1 text-[11px] uppercase transition-colors"
                  :class="matReliefSource === 'none' ? 'border-white/70 bg-white/[0.10] text-white' : 'border-white/[0.10] bg-white/[0.04] text-white/55 hover:text-white/85'"
                  @click="matReliefSource = 'none'">None</button>
                <button type="button"
                  class="flex-1 rounded border px-2 py-1 text-[11px] uppercase transition-colors"
                  :class="matReliefSource === 'shader' ? 'border-white/70 bg-white/[0.10] text-white' : 'border-white/[0.10] bg-white/[0.04] text-white/55 hover:text-white/85'"
                  @click="matReliefSource = 'shader'">Effect</button>
                <button type="button"
                  class="flex-1 rounded border px-2 py-1 text-[11px] uppercase transition-colors"
                  :class="matReliefSource === 'image' ? 'border-white/70 bg-white/[0.10] text-white' : 'border-white/[0.10] bg-white/[0.04] text-white/55 hover:text-white/85'"
                  @click="matReliefSource = 'image'">Image</button>
              </div>
            </div>
            <!-- I3 fix (final review): `normalImage` is independent of `matReliefSource` (see
                 config.ts's doc) — materials.ts keeps applying it no matter what Relief is set
                 to, but the ONLY control that could clear it used to live inside the Image
                 branch below, so switching Relief to None/Effect after checking "Already a
                 normal map" left the tilt bound with no way to remove it. Visible whenever a
                 normal map is actually set, regardless of source. -->
            <div v-if="selected?.material.normalImage" class="flex items-center justify-between rounded border border-white/10 bg-white/[0.03] px-2 py-1.5">
              <div>
                <span class="text-[11px] text-white/55">Normal map bound</span>
                <p class="text-[10px] text-white/35">Applied regardless of the Relief source above</p>
              </div>
              <button type="button" class="text-[11px] text-white/55 underline hover:text-white/85" @click="removeNormalMap">Remove</button>
            </div>
            <template v-if="matReliefSource !== 'none'">
              <template v-if="!(matReliefSource === 'image' && matIsNormalMap)">
                <StudioSlider v-model="matReliefScale" label="Depth"
                  hint="How raised or recessed the surface detail looks" :min="0" :max="4" :step="0.01" />
                <StudioSlider v-model="matReliefContrast" label="Contrast"
                  hint="Deepens the light and dark areas so the relief catches the light." :min="1" :max="6" :step="0.1" />
                <StudioSlider v-model="matReliefTiling" label="Tiling"
                  hint="How many times the pattern repeats across the surface — higher is finer." :min="0.25" :max="12" :step="0.25" />
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-white/55">Invert</span>
                  <StudioSwitch v-model="matReliefInvert" />
                </div>
              </template>

              <!-- image: reuses the texture-upload structure at :1801-1827 (hidden file
                   input, StudioButton + Loader2 spinner, object-id-keyed uploading state,
                   target captured before await). No conversion choice here (C2 fix, final
                   review): the uploaded file's ORIGINAL bytes are stored as-is; materials.ts
                   converts to a height field exactly once, at texture-build time. -->
              <template v-if="matReliefSource === 'image'">
                <input ref="reliefFileInput" type="file" accept="image/*" class="hidden" @change="onReliefFilePicked" />
                <div class="flex items-center gap-2">
                  <img v-if="matReliefImage" class="size-12 rounded object-cover"
                    :src="texViewUrl(matReliefImage)" alt="" />
                  <StudioButton :disabled="reliefUploading === selected.id" @click="triggerReliefUpload">
                    <span class="flex items-center gap-1.5">
                      <Loader2 v-if="reliefUploading === selected.id" class="h-3.5 w-3.5 animate-spin" />
                      <Upload v-else class="h-3.5 w-3.5" />
                      {{ reliefUploading === selected.id ? 'Uploading…' : matReliefImage ? 'Replace image' : 'Upload image' }}
                    </span>
                  </StudioButton>
                  <!-- AI height generation (Task 6): text → fal FLUX tile → fal depth model,
                       via /api/scene3d/gen-map. Explicit button + inline prompt panel — never
                       automatic, costs money and takes seconds. -->
                  <StudioButton :disabled="reliefGenBusy === selected.id" @click="toggleReliefGen">
                    <span class="flex items-center gap-1.5">
                      <Loader2 v-if="reliefGenBusy === selected.id" class="h-3.5 w-3.5 animate-spin" />
                      <Sparkles v-else class="h-3.5 w-3.5" />
                      {{ reliefGenBusy === selected.id ? 'Generating…' : 'Generate…' }}
                    </span>
                  </StudioButton>
                </div>
                <p v-if="reliefUploadError[selected.id] || (matReliefImage && texLoadError[matReliefImage])"
                  class="text-[11px] text-red-400/90">texture failed</p>
                <p v-else-if="reliefFlatWarning[selected.id]" class="text-[11px] text-amber-400/80">
                  This image is very smooth — raise Contrast, or try one with finer detail.
                </p>
                <div v-if="reliefGenOpen" class="space-y-1.5 rounded border border-white/10 bg-white/[0.03] p-2">
                  <textarea
                    v-model="reliefGenPrompt"
                    rows="2"
                    placeholder="Hammered copper, worn oak planks…"
                    :disabled="reliefGenBusy === selected.id"
                    class="w-full resize-none rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 outline-none focus:border-white/25"
                  />
                  <StudioButton
                    variant="primary"
                    :disabled="!reliefGenPrompt.trim() || reliefGenBusy === selected.id"
                    @click="generateReliefFromPrompt"
                  >
                    <span class="flex items-center gap-1.5">
                      <Loader2 v-if="reliefGenBusy === selected.id" class="h-3.5 w-3.5 animate-spin" />
                      <Sparkles v-else class="h-3.5 w-3.5" />
                      {{ reliefGenBusy === selected.id ? 'Generating height map…' : 'Generate' }}
                    </span>
                  </StudioButton>
                </div>
                <p v-if="reliefGenError[selected.id]" class="text-[11px] text-red-400/90">
                  Height generation failed — try again.
                </p>
                <div v-if="matReliefImage" class="flex items-center justify-between">
                  <div>
                    <span class="text-[11px] text-white/55">Already a normal map</span>
                    <p class="text-[10px] text-white/35">For maps baked in Blender or from a game asset</p>
                  </div>
                  <StudioSwitch v-model="matIsNormalMap" />
                </div>
              </template>

              <!-- shader: same ShaderFillEditor binding as the shaderFill branch above, just
                   pointed at relief.spec instead of material.shader. -->
              <template v-if="matReliefSource === 'shader'">
                <ShaderFillEditor v-model="matReliefSpec" :show-anchor="false" />
              </template>
            </template>
          </div>
        </div>
      </StudioSection>

      <StudioSection v-if="selectedIsLight" title="Light" @pointerdown.capture="onControlsPointerDown">
        <!-- Light controls: a peer of the material sub-groups above, gated on
             selectedIsLight (not selectedIsPrimitive) since lights aren't primitives. -->
        <template v-if="selectedIsLight">
          <div>
            <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Light</p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Color</span>
                <StudioColor v-model="lightColor" />
              </div>
              <StudioSlider v-model="lightIntensity" label="Intensity" hint="Brightness of this light — point/spot use physical falloff, so they scale much higher" :min="0" :max="lightIntensityMaxValue" :step="1" />

              <template v-if="selectedLight?.light === 'point' || selectedLight?.light === 'spot'">
                <StudioSlider v-model="lightDistance" label="Distance" hint="How far the light reaches — 0 means infinite" :min="0" :max="30" :step="0.5" />
                <StudioSlider v-model="lightDecay" label="Decay" hint="How quickly the light fades over distance" :min="0" :max="3" :step="0.1" />
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-white/55">Cast shadow</span>
                  <StudioSwitch v-model="lightCastShadow" />
                </div>
              </template>

              <template v-if="selectedLight?.light === 'spot'">
                <StudioSlider v-model="lightAngle" label="Angle" hint="Cone half-angle of the spot beam" :min="0.05" :max="1.4" :step="0.01" />
                <StudioSlider v-model="lightPenumbra" label="Penumbra" hint="Softness of the spot beam's edge" :min="0" :max="1" :step="0.05" />
              </template>

              <template v-if="selectedLight?.light === 'rect'">
                <StudioSlider v-model="lightWidth" label="Width" hint="Width of the area light panel" :min="0.2" :max="10" :step="0.1" />
                <StudioSlider v-model="lightHeight" label="Height" hint="Height of the area light panel" :min="0.2" :max="10" :step="0.1" />
              </template>
            </div>
          </div>
        </template>
      </StudioSection>

      <StudioSection title="Camera">
        <StudioSlider v-model="doc.camera.fov" label="FOV" hint="Camera field of view — how wide the lens sees" :min="15" :max="100" :step="1" />
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Output</label>
          <StudioSegmented v-model="outputProxy" :options="OUTPUT_OPTIONS" />
        </div>
      </StudioSection>

      <StudioSection title="Lighting">
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Preset</label>
          <StudioSegmented v-model="lightingPresetProxy" :options="LIGHTING_PRESETS" />
        </div>
        <StudioSlider v-model="doc.lighting.sunAzimuth" label="Sun azimuth" hint="Compass direction the sunlight comes from" :min="0" :max="360" :step="1" />
        <StudioSlider v-model="doc.lighting.sunElevation" label="Sun elevation" hint="How high the sun sits above the horizon" :min="5" :max="90" :step="1" />
        <StudioSlider v-model="doc.lighting.sunIntensity" label="Sun intensity" hint="How bright the main sunlight is" :min="0" :max="3" :step="0.05" />
        <StudioSlider v-model="doc.lighting.ambient" label="Ambient" hint="Soft fill light that lifts the shadows" :min="0" :max="2" :step="0.05" />
      </StudioSection>

      <StudioSection title="Background">
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Floor</span>
          <StudioSwitch v-model="doc.showFloor" />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Transparent</span>
          <StudioSwitch v-model="bgTransparent" />
        </div>
        <div v-if="!bgTransparent" class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Color</span>
          <StudioColor v-model="bgColorProxy" />
        </div>
      </StudioSection>

      <!-- Shared post-processing — reuses Space Type's PostChain (bloom, colour
           grade, chromatic aberration, lens blur). Applies to the viewport AND
           the beauty bake (see passes.ts). -->
      <StudioSection title="Effects">
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Ambient occlusion</span>
          <StudioSwitch v-model="doc.post.gtao" />
        </div>
        <template v-if="doc.post.gtao">
          <StudioSlider v-model="doc.post.gtaoRadius" label="Radius" hint="How far around each point to check for blockers, in scene units" :min="0.05" :max="3" :step="0.05" />
          <StudioSlider v-model="doc.post.gtaoIntensity" label="Intensity" hint="How dark the occluded areas get" :min="0" :max="2" :step="0.05" />
          <StudioSlider v-model="doc.post.gtaoThickness" label="Thickness" hint="How solid nearby surfaces are treated as blockers" :min="0.05" :max="2" :step="0.05" />
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Bloom</span>
          <StudioSwitch v-model="doc.post.bloom" />
        </div>
        <template v-if="doc.post.bloom">
          <StudioSlider v-model="doc.post.bloomStrength" label="Strength" hint="How strong the glow is" :min="0" :max="3" :step="0.05" />
          <StudioSlider v-model="doc.post.bloomRadius" label="Radius" hint="How far the glow spreads" :min="0" :max="1" :step="0.05" />
          <StudioSlider v-model="doc.post.bloomThreshold" label="Threshold" hint="How bright a pixel must be before it blooms" :min="0" :max="1" :step="0.05" />
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Color</span>
          <StudioSwitch v-model="doc.post.color" />
        </div>
        <template v-if="doc.post.color">
          <StudioSlider v-model="doc.post.exposure" label="Exposure" hint="Overall brightness" :min="0.2" :max="2" :step="0.05" />
          <StudioSlider v-model="doc.post.contrast" label="Contrast" hint="Difference between darks and lights" :min="0" :max="2" :step="0.05" />
          <StudioSlider v-model="doc.post.saturation" label="Saturation" hint="How vivid the colours are" :min="0" :max="2" :step="0.05" />
          <StudioSlider v-model="doc.post.hue" label="Hue" hint="Rotates every colour around the wheel" :min="-3.14" :max="3.14" :step="0.05" />
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Chroma</span>
          <StudioSwitch v-model="doc.post.chroma" />
        </div>
        <StudioSlider v-if="doc.post.chroma" v-model="doc.post.chromaAmount" label="Amount" hint="Colour fringing at the edges" :min="0" :max="1.5" :step="0.02" />

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Lens blur</span>
          <StudioSwitch v-model="doc.post.blur" />
        </div>
        <StudioSlider v-if="doc.post.blur" v-model="doc.post.blurAmount" label="Amount" hint="Soft bokeh-style blur" :min="0" :max="0.04" :step="0.002" />

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Film</span>
          <StudioSwitch v-model="doc.post.film" />
        </div>
        <template v-if="doc.post.film">
          <StudioSlider v-model="doc.post.filmIntensity" label="Intensity" hint="How strong the grain is" :min="0" :max="1" :step="0.01" />
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Grayscale</span>
            <StudioSwitch v-model="doc.post.filmGrayscale" />
          </div>
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Halftone</span>
          <StudioSwitch v-model="doc.post.halftone" />
        </div>
        <template v-if="doc.post.halftone">
          <StudioSlider v-model="doc.post.halftoneRadius" label="Radius" hint="Size of the print dots" :min="1" :max="20" :step="0.5" />
          <StudioSlider v-model="doc.post.halftoneScatter" label="Scatter" hint="Randomises dot placement" :min="0" :max="1" :step="0.02" />
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Dot screen</span>
          <StudioSwitch v-model="doc.post.dotScreen" />
        </div>
        <template v-if="doc.post.dotScreen">
          <StudioSlider v-model="doc.post.dotScreenScale" label="Scale" hint="Size of the dot pattern" :min="0.2" :max="4" :step="0.1" />
          <StudioSlider v-model="doc.post.dotScreenAngle" label="Angle" hint="Rotates the dot grid" :min="-3.14" :max="3.14" :step="0.05" />
        </template>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Glitch</span>
          <StudioSwitch v-model="doc.post.glitch" />
        </div>
      </StudioSection>
      </template>
      <template v-else>
        <StudioSection title="Motion">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Animate scene</span>
            <StudioSwitch v-model="motionOn" />
          </div>
          <template v-if="motionOn">
            <StudioSlider v-model="doc.motion.duration" label="Duration (s)" :min="1" :max="60" :step="0.5"
                          hint="Scene length. Video export renders FPS × Duration frames — a 60s clip at 30fps is 1800." />
            <StudioSlider v-model="doc.motion.fps" label="FPS" :min="12" :max="60" :step="1" />
            <div class="grid grid-cols-3 gap-1">
              <button v-for="key in (['showcase', 'reveal', 'loop'] as const)" :key="key" type="button"
                      class="nodrag rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-[11px] text-white/70 hover:bg-white/10"
                      :class="{ 'border-sky-400/60 text-white': doc.motion.template === key }"
                      @click="applyTemplate(key)">
                {{ key === 'showcase' ? 'Showcase' : key === 'reveal' ? 'Reveal' : 'Loop' }}
              </button>
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-white/55">Camera</label>
              <StudioSelect :model-value="doc.camera.motion?.preset ?? 'none'" :options="CAMERA_OPTIONS"
                @update:model-value="(v: string) => doc.camera.motion = v === 'none' ? undefined : { preset: v as CameraMotion['preset'], speed: doc.camera.motion?.speed ?? 1, amount: doc.camera.motion?.amount ?? 1 }" />
            </div>
            <template v-if="doc.camera.motion">
              <StudioSlider v-if="CAMERA_USES_CYCLES.includes(doc.camera.motion.preset)"
                            v-model="doc.camera.motion.speed" label="Camera cycles" :min="1" :max="20" :step="1"
                            hint="How many times the camera move repeats across the scene." />
              <StudioSlider v-if="CAMERA_USES_AMOUNT.includes(doc.camera.motion.preset)"
                            v-model="doc.camera.motion.amount" label="Camera amount" :min="0" :max="3" :step="0.1" />
            </template>
          </template>
        </StudioSection>

        <StudioSection v-if="motionOn && selected" title="Object motion">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Loop</label>
            <StudioSelect :model-value="selected.motion?.loop?.kind ?? 'none'" :options="LOOP_OPTIONS"
              @update:model-value="(v: string) => setObjectLoop(selected!, v as LoopKind)" />
          </div>
          <template v-if="selected.motion?.loop">
            <StudioSlider v-model="selected.motion.loop.speed" label="Cycles" :min="1" :max="20" :step="1"
                          hint="How many times the loop repeats across the scene. Whole numbers only, so it closes seamlessly at the end." />
            <StudioSlider v-if="LOOP_USES_AMOUNT.includes(selected.motion.loop.kind)"
                          v-model="selected.motion.loop.amount" label="Amount" :min="0" :max="3" :step="0.1" />
          </template>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">In</label>
            <StudioSelect :model-value="selected.motion?.in?.preset ?? 'none'" :options="IN_OPTIONS"
              @update:model-value="(v: string) => setObjectTransition(selected!, 'in', v as TransitionPreset | 'none')" />
          </div>
          <template v-if="selected?.motion?.in">
            <div v-if="['move', 'rise'].includes(selected.motion.in.preset)">
              <label class="mb-1 block text-[11px] text-white/55">In direction</label>
              <StudioSelect :model-value="selected.motion.in.direction ?? 'left'" :options="DIRECTION_OPTIONS"
                @update:model-value="(v: string) => setObjectDirection(selected!, 'in', v as Direction)" />
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-white/55">In ease</label>
              <StudioSelect :model-value="easeKey('in')" :options="EASE_KEY_OPTIONS"
                @update:model-value="(v: string) => setEaseKey('in', v)" />
              <CurveEditor v-if="curveProxy('in') !== null" class="mt-1"
                :model-value="curveProxy('in')!" @update:model-value="(v: string) => setCurve('in', v)" />
            </div>
          </template>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Out</label>
            <StudioSelect :model-value="selected.motion?.out?.preset ?? 'none'" :options="OUT_OPTIONS"
              @update:model-value="(v: string) => setObjectTransition(selected!, 'out', v as TransitionPreset | 'none')" />
          </div>
          <template v-if="selected?.motion?.out">
            <div v-if="['move', 'rise'].includes(selected.motion.out.preset)">
              <label class="mb-1 block text-[11px] text-white/55">Out direction</label>
              <StudioSelect :model-value="selected.motion.out.direction ?? 'left'" :options="DIRECTION_OPTIONS"
                @update:model-value="(v: string) => setObjectDirection(selected!, 'out', v as Direction)" />
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-white/55">Out ease</label>
              <StudioSelect :model-value="easeKey('out')" :options="EASE_KEY_OPTIONS"
                @update:model-value="(v: string) => setEaseKey('out', v)" />
              <CurveEditor v-if="curveProxy('out') !== null" class="mt-1"
                :model-value="curveProxy('out')!" @update:model-value="(v: string) => setCurve('out', v)" />
            </div>
          </template>
        </StudioSection>

      </template>

      <!-- Sticky action footer: Save + Export, pinned to the bottom-right of the
           inspector column. mt-auto pins it to the bottom when the column is short;
           sticky bottom-0 keeps it visible once the inspector scrolls. -->
      <div class="sticky bottom-0 z-10 mt-auto border-t border-white/10 bg-[#0e0e10] pb-1 pt-2">
        <p v-if="bakeError && !baking" class="mb-1.5 text-right text-xs text-red-400/90">{{ bakeError }}</p>
        <p v-else-if="savedFlash" class="mb-1.5 text-right text-xs text-emerald-400/80">Saved ✓</p>
        <p v-else-if="dirty && !baking" class="mb-1.5 text-right text-xs text-amber-400/70">Not exported to canvas</p>
        <div class="flex items-center justify-end gap-2">
          <StudioButton variant="secondary" :disabled="baking" @click="saveScene">Save</StudioButton>
          <StudioButton variant="primary" :disabled="baking || !doc.objects.length" @click="exportToCanvas">
            <span class="flex items-center gap-1.5">
              <Loader2 v-if="baking" class="h-4 w-4 animate-spin" />
              {{ baking ? 'Exporting…' : 'Export to Canvas' }}
            </span>
          </StudioButton>
        </div>
      </div>
    </template>
  </StudioModalShell>
</template>

<style scoped>
/* Compact numeric transform input — matches the studio kit's mono/muted language. */
.studio-num {
  width: 100%;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 0.25rem 0.375rem;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  outline: none;
  -moz-appearance: textfield;
}
.studio-num:focus {
  background: rgba(255, 255, 255, 0.1);
}
.studio-num::-webkit-outer-spin-button,
.studio-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
