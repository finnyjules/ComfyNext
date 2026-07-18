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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Box, Plus, Trash2, Copy, Eye, EyeOff, Loader2, Upload, RotateCcw,
} from 'lucide-vue-next'
import {
  parseDoc, serializeDoc, createPrimitive, createGlbObject,
  LIGHTING_PRESETS, MATERIAL_TYPES, MATERIAL_DEFAULTS,
  type SceneDoc, type SceneObject, type PrimitiveKind, type MaterialType,
} from '~/lib/scene3d/config'
import { MATCAP_IDS, matcapThumb, onTextureError } from '~/lib/scene3d/materials'
import { PRIM_GROUPS } from '~/lib/scene3d/primGroups'
import { SceneEngine, baseSizeFor } from '~/lib/scene3d/engine'
import { PRIMITIVE_PARAMS, paramValue } from '~/lib/scene3d/primParams'
import { SceneInteraction } from '~/lib/scene3d/interaction'
import { loadGlb, GLB_SIZE_CAP_BYTES } from '~/lib/scene3d/glb'
import { renderPasses } from '~/lib/scene3d/passes'
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
const selectedId = ref<string | null>(null)
const selected = computed<SceneObject | null>(() => doc.objects.find((o) => o.id === selectedId.value) ?? null)
const selectedIsPrimitive = computed(() => selected.value?.kind === 'primitive')
const snap = ref(false)
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

// Selection field proxies — nullable-safe so vue-tsc stays happy without template narrowing.
const matColor = computed<string>({ get: () => selected.value?.material.color ?? '#9aa3af', set: (v) => { if (selected.value) selected.value.material.color = v } })
const matRoughness = computed<number>({ get: () => selected.value?.material.roughness ?? 0.6, set: (v) => { if (selected.value) selected.value.material.roughness = v } })
const matMetalness = computed<number>({ get: () => selected.value?.material.metalness ?? 0, set: (v) => { if (selected.value) selected.value.material.metalness = v } })

// Material type + per-type params. Proxies fall back to MATERIAL_DEFAULTS so
// sliders always have a number; the doc only records what the user touches.
const matType = computed<MaterialType>({
  get: () => selected.value?.material.type ?? 'standard',
  set: (v) => { if (selected.value) selected.value.material.type = v },
})
function matParam<K extends keyof typeof MATERIAL_DEFAULTS>(key: K) {
  return computed<any>({
    get: () => (selected.value?.material as any)?.[key] ?? MATERIAL_DEFAULTS[key],
    set: (v) => { if (selected.value) (selected.value.material as any)[key] = v },
  })
}
const matToonSteps = matParam('toonSteps')
const matMatcap = matParam('matcap')
const matIor = matParam('ior')
const matTransmission = matParam('transmission')
const matThickness = matParam('thickness')
const matFresnelColor = matParam('fresnelColor')
const matFresnelPower = matParam('fresnelPower')
const matGradientB = matParam('gradientB')
const matGradientAxis = matParam('gradientAxis')
const matGradientShading = matParam('gradientShading')
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
  if (!file || !target || target.kind !== 'primitive') return
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

// Numeric transform fields (per-axis) — position/scale stored & shown raw, rotation
// stored in radians but edited in degrees. Setters replace the whole array so the
// deep doc watcher fires (engine syncs); gizmo drags mutate the same arrays, so the
// computed getters re-read and the inputs update — two-way, no extra wiring.
const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
function axisField(prop: 'position' | 'scale', axis: 0 | 1 | 2) {
  return computed<number>({
    get: () => selected.value?.[prop][axis] ?? (prop === 'scale' ? 1 : 0),
    set: (v) => {
      const s = selected.value
      if (!s || !Number.isFinite(v)) return
      const next = [...s[prop]] as [number, number, number]
      next[axis] = v
      s[prop] = next
    },
  })
}
function rotField(axis: 0 | 1 | 2) {
  return computed<number>({
    get: () => (selected.value ? selected.value.rotation[axis] * RAD2DEG : 0),
    set: (v) => {
      const s = selected.value
      if (!s || !Number.isFinite(v)) return
      const next = [...s.rotation] as [number, number, number]
      next[axis] = v * DEG2RAD
      s.rotation = next
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

// Size = scale expressed in scene units. Base dimensions come from the geometry
// itself (rebuilt from the doc, so they follow parameter changes — a fatter torus
// tube is a bigger torus). GLBs fall back to the engine's measured bounds.
const baseSize = computed<[number, number, number]>(() => {
  const o = selected.value
  if (!o) return [1, 1, 1]
  if (o.kind === 'primitive') return baseSizeFor(o.primitive, o.params)
  return engine?.baseSizeOf(o.id) ?? [1, 1, 1]
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

onMounted(() => {
  webglOk.value = detectWebGL()
  if (!webglOk.value || !canvasEl.value || !viewportEl.value) return
  const rect = viewportEl.value.getBoundingClientRect()
  engine = new SceneEngine(canvasEl.value, rect.width, rect.height)
  engine.applyCameraFromDoc(doc)
  interaction = new SceneInteraction(engine, viewportEl.value, {
    onSelect: (id) => { selectedId.value = id },
    onTransform: (id, t) => {
      const o = doc.objects.find((x) => x.id === id)
      if (o) { o.position = t.position; o.rotation = t.rotation; o.scale = t.scale }
    },
  })
  interaction.orbit.target.set(...doc.camera.target)
  engine.syncFromDoc(doc)
  // Warm-up every restored GLB so a scene loaded from scene_state surfaces load
  // failures in the list too (the engine's own load leaves an empty group silently;
  // addGlb/duplicateObject only warm the ones created this session).
  for (const o of doc.objects) {
    if (o.kind === 'glb') loadGlb(o.url).catch(() => { glbError[o.id] = true })
  }
  const loop = () => {
    interaction?.orbit.update()
    engine?.render()
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
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerdown', onPrimMenuOutside, true)
  cancelAnimationFrame(raf)
  ro?.disconnect()
  interaction?.dispose()
  engine?.dispose()
})

// Any edit re-dirties and clears a stale bake failure so the amber "unbaked
// changes" indicator isn't masked by an old red "Bake failed — retry".
watch(doc, () => { dirty.value = true; bakeError.value = ''; engine?.syncFromDoc(doc) }, { deep: true })
watch(selectedId, (id) => interaction?.select(id))
watch(snap, (s) => interaction?.setSnap(s))

function onKey(e: KeyboardEvent) {
  // Never hijack modified chords (Cmd+R reload, Ctrl/Alt combos).
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
  // (No W/E/R mode shortcuts — the combined gizmo moves/rotates/scales at once.)
  if (e.key === 'Escape') {
    // Open primitive menu owns Esc: close it, never the modal.
    if (primMenuOpen.value) {
      e.preventDefault()
      e.stopImmediatePropagation()
      primMenuOpen.value = false
      return
    }
    // An open StudioColor popover owns Escape (its own capture listener closes
    // it); it registered after us so we'd fire first — yield to it.
    if (document.querySelector('[data-studio-color-pop]')) return
    if (selectedId.value) {
      // Deselect only: preventDefault + stopImmediatePropagation keep the
      // shell's window keydown (and anything else) from closing the modal.
      e.preventDefault()
      e.stopImmediatePropagation()
      selectedId.value = null
    }
    // No selection → fall through untouched; the shell's Escape closes.
  }
  else if (e.key === 'Backspace' && selectedId.value) removeObject(selectedId.value)
}

// ── Object operations ─────────────────────────────────────────────────────────
function addPrimitive(kind: PrimitiveKind) {
  const o = createPrimitive(kind, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
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
  const i = doc.objects.findIndex((o) => o.id === id)
  if (i >= 0) doc.objects.splice(i, 1)
  if (selectedId.value === id) selectedId.value = null
  delete glbError[id]
}
function duplicateObject(id: string) {
  const src = doc.objects.find((o) => o.id === id)
  if (!src) return
  const copy = src.kind === 'primitive'
    ? createPrimitive(src.primitive, doc.objects)
    : createGlbObject(src.url, doc.objects)
  Object.assign(copy, {
    position: [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5],
    rotation: [...src.rotation], scale: [...src.scale], material: { ...src.material },
  })
  doc.objects.push(copy)
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
  try {
    const passes = await renderPasses(engine, doc)
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
  <StudioModalShell title="3D Studio" wide @close="onClose">
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
        </div>

        <!-- Bottom add-toolbar (Grid editor pill style): + Primitive menu · Upload GLB -->
        <div v-if="webglOk" class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10" data-prim-menu @pointerdown.stop>
          <p v-if="uploadError" class="mb-2 text-center text-[11px] text-red-400/90">{{ uploadError }}</p>
          <div class="relative flex items-center gap-1 rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-1.5 shadow-lg">
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer"
              :class="primMenuOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              @click="primMenuOpen = !primMenuOpen"
            >
              <Plus class="size-4" /> Primitive
            </button>
            <div class="mx-0.5 h-5 w-px bg-white/10" />
            <button
              type="button"
              :disabled="uploading"
              class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-50"
              @click="triggerGlbUpload"
            >
              <Loader2 v-if="uploading" class="size-4 animate-spin" />
              <Upload v-else class="size-4" />
              {{ uploading ? 'Uploading…' : 'Upload GLB' }}
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
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                    @click="pickPrimitive(p.kind)"
                  >
                    <component :is="p.icon" class="size-4 shrink-0 opacity-70" />
                    {{ p.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Object list: its own dedicated panel (like Smart Layout / Frame), separate
         from the inspector column at right. -->
    <template #aside>
      <div class="flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.04]">
        <div class="shrink-0 px-3 py-2.5 text-[11px] font-medium text-white/50">Objects</div>
        <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          <div v-if="!doc.objects.length" class="px-1 text-xs leading-relaxed text-white/40">
            Empty scene — add a primitive or upload a GLB from the toolbar below<span v-if="wiredGlbUrl">, or import the wired model</span>.
          </div>
          <div v-for="o in doc.objects" :key="o.id"
            class="group flex items-center gap-2 rounded px-2 py-1 text-xs"
            :class="o.id === selectedId ? 'bg-white/15' : 'hover:bg-white/5'"
            @click="selectedId = o.id">
            <Box class="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span class="flex-1 truncate" :class="glbError[o.id] ? 'text-red-400' : ''">{{ o.name }}</span>
            <button v-if="glbError[o.id]" type="button" class="text-red-400 opacity-90 hover:opacity-100"
              title="Load failed — retry" @click.stop="retryGlb(o.id)"><RotateCcw class="h-3.5 w-3.5" /></button>
            <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="o.visible = !o.visible">
              <component :is="o.visible ? Eye : EyeOff" class="h-3.5 w-3.5" />
            </button>
            <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="duplicateObject(o.id)"><Copy class="h-3.5 w-3.5" /></button>
            <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="removeObject(o.id)"><Trash2 class="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div v-if="wiredGlbUrl" class="shrink-0 border-t border-white/[0.08] p-2">
          <StudioButton @click="addGlb(wiredGlbUrl)">
            <span class="flex items-center gap-1.5"><Plus class="h-3.5 w-3.5" /> Import wired model</span>
          </StudioButton>
        </div>
        <input ref="glbFileInput" type="file" accept=".glb,model/gltf-binary" class="hidden" @change="onGlbFilePicked" />
      </div>
    </template>

    <template #controls>
      <StudioSection v-if="selected" title="Selection">
        <div v-if="selectedIsPrimitive">
          <label class="mb-1 block text-[11px] text-white/55">Material</label>
          <StudioSelect v-model="matType" :options="MATERIAL_TYPES" />
        </div>

        <!-- physical surface: standard + glass share the grouped panel -->
        <template v-if="selectedIsPrimitive && (matType === 'standard' || matType === 'glass')">
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

        <!-- toon -->
        <template v-else-if="selectedIsPrimitive && matType === 'toon'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matToonSteps" label="Steps" hint="Number of flat cel-shading bands" :min="2" :max="5" :step="1" />
        </template>

        <!-- matcap -->
        <template v-else-if="selectedIsPrimitive && matType === 'matcap'">
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
        <template v-else-if="selectedIsPrimitive && matType === 'fresnel'">
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
        <template v-else-if="selectedIsPrimitive && matType === 'gradient'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color B</span>
            <StudioColor v-model="matGradientB" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Axis</label>
            <StudioSegmented v-model="matGradientAxis" :options="['x', 'y', 'z']" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Shading</label>
            <StudioSegmented v-model="matGradientShading" :options="['smooth', 'faceted', 'prismatic']" />
          </div>
        </template>

        <!-- image -->
        <template v-else-if="selectedIsPrimitive && matType === 'image'">
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

        <!-- Geometry: a peer of the material sub-groups (plain details, no card
             chrome), but open by default — these are the shape's primary knobs. -->
        <details v-if="geoSpecs.length" class="group" open>
          <summary class="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 list-none hover:text-white/60 [&::-webkit-details-marker]:hidden"><span class="inline-block text-white/30 transition-transform group-open:rotate-90">›</span>Geometry</summary>
          <div class="space-y-3 pt-1">
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
        </details>

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
        <div>
          <label class="mb-1 block text-[11px] text-white/55">Size</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="sizeX" type="number" step="0.05" aria-label="Size X" class="studio-num" />
            <input v-model.number="sizeY" type="number" step="0.05" aria-label="Size Y" class="studio-num" />
            <input v-model.number="sizeZ" type="number" step="0.05" aria-label="Size Z" class="studio-num" />
          </div>
        </div>
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
          <span class="text-[11px] text-white/55">Transparent</span>
          <StudioSwitch v-model="bgTransparent" />
        </div>
        <div v-if="!bgTransparent" class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Color</span>
          <StudioColor v-model="bgColorProxy" />
        </div>
      </StudioSection>

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
