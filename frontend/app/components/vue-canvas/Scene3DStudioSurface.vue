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
import { Box, Camera, Plus, Trash2, Copy, Eye, EyeOff, Loader2, Upload, RotateCcw } from 'lucide-vue-next'
import {
  parseDoc, serializeDoc, createPrimitive, createGlbObject,
  PRIMITIVE_KINDS, LIGHTING_PRESETS,
  type SceneDoc, type SceneObject, type PrimitiveKind,
} from '~/lib/scene3d/config'
import { SceneEngine } from '~/lib/scene3d/engine'
import { SceneInteraction, type GizmoMode } from '~/lib/scene3d/interaction'
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
const gizmoMode = ref<GizmoMode>('translate')
const snap = ref(false)
const dirty = ref(false)      // doc changed since last bake
const baking = ref(false)
const bakeError = ref('')       // last bake failure message (inline "retry")
const glbError = reactive<Record<string, boolean>>({})
const webglOk = ref(true)
const uploading = ref(false)    // GLB file upload in flight
const uploadError = ref('')     // inline error for the Upload GLB control
const glbFileInput = ref<HTMLInputElement | null>(null)

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
  cancelAnimationFrame(raf)
  ro?.disconnect()
  interaction?.dispose()
  engine?.dispose()
})

// Any edit re-dirties and clears a stale bake failure so the amber "unbaked
// changes" indicator isn't masked by an old red "Bake failed — retry".
watch(doc, () => { dirty.value = true; bakeError.value = ''; engine?.syncFromDoc(doc) }, { deep: true })
watch(selectedId, (id) => interaction?.select(id))
watch(gizmoMode, (m) => interaction?.setMode(m))
watch(snap, (s) => interaction?.setSnap(s))

function onKey(e: KeyboardEvent) {
  // Never hijack modified chords (Cmd+R reload, Ctrl/Alt combos) into gizmo shortcuts.
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
  // Case-insensitive so CapsLock / Shift still trigger W/E/R.
  const k = e.key.toLowerCase()
  if (k === 'w') gizmoMode.value = 'translate'
  else if (k === 'e') gizmoMode.value = 'rotate'
  else if (k === 'r') gizmoMode.value = 'scale'
  else if (e.key === 'Escape') {
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

function setCameraFromView() {
  if (!engine || !interaction) return
  doc.camera.position = engine.camera.position.toArray() as [number, number, number]
  doc.camera.target = interaction.orbit.target.toArray() as [number, number, number]
}

// ── Bake ──────────────────────────────────────────────────────────────────────
const inpaint = useInpaint()
async function bake(): Promise<void> {
  if (!engine || baking.value) return
  baking.value = true
  bakeError.value = ''
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

async function onClose() {
  setWidget('scene_state', serializeDoc(doc)) // scene always persists, baked or not
  // A bake already failed and its inline "Bake failed — retry" is showing: this
  // second close attempt (Esc/X) is the user's explicit escape hatch — leave without
  // re-baking so a persistently failing bake can't trap them (scene_state is saved).
  if (bakeError.value) { emit('close'); return }
  if (dirty.value && doc.objects.length && engine) {
    await bake()
    // Auto-bake failed: keep the surface open so the inline error is visible; the
    // user can retry Bake or close again to force-exit (handled above).
    if (bakeError.value) return
  }
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
        <!-- Overlay toolbar: add-object · gizmo mode · snap · set camera -->
        <div v-if="webglOk" class="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/60 p-1.5 backdrop-blur">
          <select
            class="rounded bg-white/10 px-2 py-1 text-xs text-white"
            :value="''"
            @change="addPrimitive(($event.target as HTMLSelectElement).value as PrimitiveKind); ($event.target as HTMLSelectElement).value = ''"
          >
            <option value="" disabled>+ Add</option>
            <option v-for="k in PRIMITIVE_KINDS" :key="k" :value="k" class="bg-neutral-900">{{ k }}</option>
          </select>
          <div class="flex overflow-hidden rounded bg-white/10 text-xs text-white">
            <button v-for="m in (['translate', 'rotate', 'scale'] as const)" :key="m" type="button"
              class="px-2 py-1 capitalize" :class="gizmoMode === m ? 'bg-white/25' : 'hover:bg-white/15'"
              @click="gizmoMode = m">{{ m === 'translate' ? 'move' : m }}</button>
          </div>
          <button type="button" class="rounded px-2 py-1 text-xs"
            :class="snap ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'"
            @click="snap = !snap">snap</button>
          <button type="button" class="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/15"
            @click="setCameraFromView"><Camera class="h-3.5 w-3.5" /> Set camera</button>
        </div>
      </div>
    </template>

    <template #controls>
      <StudioSection title="Objects">
        <div v-if="!doc.objects.length" class="text-xs text-white/40">
          Empty scene — add a primitive from the viewport toolbar, upload a GLB<span v-if="wiredGlbUrl">, or import the wired model</span> below.
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
        <StudioButton v-if="wiredGlbUrl" @click="addGlb(wiredGlbUrl)">
          <span class="flex items-center gap-1.5"><Plus class="h-3.5 w-3.5" /> Import wired model</span>
        </StudioButton>
        <input ref="glbFileInput" type="file" accept=".glb,model/gltf-binary" class="hidden" @change="onGlbFilePicked" />
        <StudioButton :disabled="uploading" @click="triggerGlbUpload">
          <span class="flex items-center gap-1.5">
            <Loader2 v-if="uploading" class="h-3.5 w-3.5 animate-spin" />
            <Upload v-else class="h-3.5 w-3.5" />
            {{ uploading ? 'Uploading…' : 'Upload GLB' }}
          </span>
        </StudioButton>
        <p v-if="uploadError" class="text-[11px] text-red-400/90">{{ uploadError }}</p>
      </StudioSection>

      <StudioSection v-if="selected" title="Selection">
        <div v-if="selectedIsPrimitive" class="flex items-center justify-between">
          <span class="text-[11px] text-white/55">Color</span>
          <StudioColor v-model="matColor" />
        </div>
        <StudioSlider v-if="selectedIsPrimitive" v-model="matRoughness" label="Roughness" :min="0" :max="1" :step="0.01" />
        <StudioSlider v-if="selectedIsPrimitive" v-model="matMetalness" label="Metalness" :min="0" :max="1" :step="0.01" />
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
          <label class="mb-1 block text-[11px] text-white/55">Scale</label>
          <div class="grid grid-cols-3 gap-1.5">
            <input v-model.number="sclX" type="number" step="0.05" aria-label="Scale X" class="studio-num" />
            <input v-model.number="sclY" type="number" step="0.05" aria-label="Scale Y" class="studio-num" />
            <input v-model.number="sclZ" type="number" step="0.05" aria-label="Scale Z" class="studio-num" />
          </div>
        </div>
      </StudioSection>

      <StudioSection title="Camera">
        <StudioSlider v-model="doc.camera.fov" label="FOV" :min="15" :max="100" :step="1" />
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
        <StudioSlider v-model="doc.lighting.sunAzimuth" label="Sun azimuth" :min="0" :max="360" :step="1" />
        <StudioSlider v-model="doc.lighting.sunElevation" label="Sun elevation" :min="5" :max="90" :step="1" />
        <StudioSlider v-model="doc.lighting.sunIntensity" label="Sun intensity" :min="0" :max="3" :step="0.05" />
        <StudioSlider v-model="doc.lighting.ambient" label="Ambient" :min="0" :max="2" :step="0.05" />
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
    </template>

    <template #actions>
      <StudioButton variant="primary" :disabled="baking || !doc.objects.length" @click="bake">
        <span class="flex items-center gap-1.5">
          <Loader2 v-if="baking" class="h-4 w-4 animate-spin" />
          {{ baking ? 'Baking…' : 'Bake' }}
        </span>
      </StudioButton>
      <span v-if="bakeError && !baking" class="text-xs text-red-400/90">{{ bakeError }}</span>
      <span v-else-if="dirty && !baking" class="text-xs text-amber-400/80">unbaked changes</span>
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
