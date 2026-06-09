<script setup lang="ts">
/**
 * 3D mannequin pose editor for the Pose Mannequin node.
 *
 * Build a procedural gray artist mannequin (usePoseRig), let the user orbit the
 * camera and rotate joints with a gizmo (forward kinematics), then bake the
 * current view to a gray render and feed it + the wired character to Nano Banana
 * 2 via /api/inpaint/pose. The result is written back onto the node.
 *
 * Three.js is imported dynamically (client-only) so this stays out of the SSR
 * bundle. Three objects are held in plain closures — NOT Vue refs — so Vue's
 * reactive proxy never wraps them (which would break Three's internal identity).
 */
import { X, Wand2, RotateCcw, Loader2, Check, AlertTriangle, Boxes } from 'lucide-vue-next'
import {
  buildMannequin, applyRotations, serializeRotations, POSE_PRESETS,
  type PoseState, type PoseRotations,
} from '~/composables/usePoseRig'
import { useInpaint, loadImage, imageToDataUrl, capDims } from '~/composables/useInpaint'

const props = defineProps<{ nodeId: string; nodes: any[]; edges: any[] }>()
const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

// ── Locate widgets + the wired character (mirrors PoseMannequinNode) ─────────
function widgetIdx(name: string): number { return node.value?.data?.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }
function widgetStr(name: string): string { const i = widgetIdx(name); return i >= 0 ? String(node.value?.data?.widgetsValues?.[i] ?? '') : '' }
function setWidget(name: string, value: any) {
  const i = widgetIdx(name)
  if (i >= 0 && node.value?.data?.widgetsValues) node.value.data.widgetsValues[i] = value
}
function inputIdx(name: string): number { return node.value?.data?.inputs?.findIndex((i: any) => i.name === name) ?? -1 }
function viewUrl(filename: string): string { return `/view?${new URLSearchParams({ filename, type: 'input' })}` }

function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  const wv = src?.data?.widgetsValues
  const wi = src?.data?.widgetDefs?.findIndex((w: any) => w.name === 'image') ?? -1
  if (wi >= 0 && wv?.[wi]) return viewUrl(String(wv[wi]))
  if (src?.data?.nodeType === 'LoadImage' && wv?.[0]) return viewUrl(String(wv[0]))
  return null
}
const characterUrl = computed<string | null>(() => {
  const idx = inputIdx('character')
  if (idx < 0) return null
  const edge = props.edges.find((e: any) => e.target === props.nodeId && e.targetHandle === `input-${idx}`)
  if (!edge) return null
  const src = props.nodes.find((n: any) => n.id === edge.source)
  return src ? resolveSrcUrl(src) : null
})

// ── UI state (reactive) ──────────────────────────────────────────────────────
const inpaint = useInpaint()
const prompt = ref(widgetStr('prompt'))
const selectedJoint = ref<string | null>(null)
const results = ref<string[]>([])
const errorMsg = ref('')
const ready = ref(false)
const multiBusy = ref(false)
const multiStatus = ref('')
const presetNames = Object.keys(POSE_PRESETS)

// ── Three.js scene (NON-reactive plain refs) ─────────────────────────────────
const stageRef = ref<HTMLDivElement | null>(null)
let THREE: any = null
let renderer: any = null
let scene: any = null
let camera: any = null
let orbit: any = null
let control: any = null
let gizmo: any = null
let joints: Record<string, any> = {}
let handleMeshes: any[] = []
let pickables: any[] = []
let raycaster: any = null
let rafId = 0
let resizeObs: ResizeObserver | null = null
let downPos: { x: number; y: number } | null = null

const BAKE_W = 768
const BAKE_H = 1024

async function initThree() {
  const el = stageRef.value
  if (!el) return
  THREE = await import('three')
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
  const { TransformControls } = await import('three/addons/controls/TransformControls.js')

  const w = el.clientWidth || 600, h = el.clientHeight || 700
  // No preserveDrawingBuffer: baking renders to an offscreen WebGLRenderTarget
  // (readRenderTargetPixels), so we never read the main framebuffer. Keeping it
  // on forces a slower compositor path and can cause flicker.
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h)
  renderer.setClearColor(0x0d0d0f, 1)
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100)
  camera.position.set(0, 1.0, 4.2)

  scene.add(new THREE.AmbientLight(0xffffff, 0.75))
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(2.5, 4, 3); scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-3, 2, -2); scene.add(fill)

  const rig = buildMannequin(THREE)
  joints = rig.joints
  handleMeshes = rig.handleMeshes
  pickables = rig.pickables
  scene.add(rig.root)

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.target.set(0, 0.95, 0)
  orbit.minDistance = 1.5
  orbit.maxDistance = 9

  control = new TransformControls(camera, renderer.domElement)
  control.setMode('rotate')
  control.setSize(0.85)
  gizmo = typeof control.getHelper === 'function' ? control.getHelper() : control
  scene.add(gizmo)
  control.addEventListener('dragging-changed', (e: any) => { orbit.enabled = !e.value })
  control.addEventListener('objectChange', () => { if (results.value.length) results.value = [] })

  raycaster = new THREE.Raycaster()

  // Restore saved pose + camera, or default to a relaxed stand.
  const saved = loadSavedState()
  applyRotations(joints, saved?.rotations || POSE_PRESETS.Stand)
  if (saved?.camera) {
    camera.position.set(...saved.camera.position)
    orbit.target.set(...saved.camera.target)
  }
  orbit.update()

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)

  resizeObs = new ResizeObserver(onResize)
  resizeObs.observe(el)

  const tick = () => {
    rafId = requestAnimationFrame(tick)
    orbit.update()
    renderer.render(scene, camera)
  }
  tick()
  ready.value = true
}

function loadSavedState(): PoseState | null {
  const raw = widgetStr('pose_state')
  if (!raw) return null
  try { return JSON.parse(raw) as PoseState } catch { return null }
}

function onResize() {
  const el = stageRef.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth || 600, h = el.clientHeight || 700
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// Click (not drag) on a joint handle selects it; empty space deselects.
function onPointerDown(e: PointerEvent) { downPos = { x: e.clientX, y: e.clientY } }
function onPointerUp(e: PointerEvent) {
  if (!downPos) return
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
  downPos = null
  // Ignore camera-orbit drags and gizmo drags — only a clean click selects.
  if (moved > 5 || control?.dragging) return
  const el = renderer.domElement
  const r = el.getBoundingClientRect()
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  // Pick the whole body (capsules + balls + handles), each tagged with the
  // joint that controls it — so clicking any limb selects the right joint.
  const hits = raycaster.intersectObjects(pickables, false)
  selectJoint(hits.length ? hits[0].object.userData.joint : null)
}

function selectJoint(name: string | null) {
  selectedJoint.value = name
  if (name && joints[name]) control.attach(joints[name])
  else control.detach()
}

// ── Presets / reset ──────────────────────────────────────────────────────────
function applyPreset(name: string) {
  const preset = POSE_PRESETS[name]
  if (!preset) return
  applyRotations(joints, preset)
  results.value = []
}
function resetPose() { applyRotations(joints, POSE_PRESETS.Stand); selectJoint(null); results.value = [] }

// ── Bake the current view to a data URL ──────────────────────────────────────
// mode 'gray'   → friendly gray mannequin (node thumbnail / what the user sees)
// mode 'normal' → surface-normal render (the conditioning sent to the model: its
//                 colors encode which way the body faces, so orientation is
//                 unambiguous — depth/gray are front/back-ambiguous; see spike).
function bake(mode: 'gray' | 'normal' = 'gray', camOverride?: any): string {
  const prevBg = scene.background
  handleMeshes.forEach(m => (m.visible = false))
  const giz = gizmo; const gizVis = giz.visible; giz.visible = false
  scene.overrideMaterial = mode === 'normal' ? new THREE.MeshNormalMaterial() : null
  scene.background = new THREE.Color(mode === 'normal' ? 0x000000 : 0xf1f1f3)

  const rt = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H, { samples: 4 })
  // Bake camera: a caller-supplied angle (multi-view), else the user's orbit.
  let bakeCam = camOverride
  if (!bakeCam) { bakeCam = camera.clone(); bakeCam.aspect = BAKE_W / BAKE_H; bakeCam.updateProjectionMatrix() }

  renderer.setRenderTarget(rt)
  renderer.render(scene, bakeCam)
  const buf = new Uint8Array(BAKE_W * BAKE_H * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, BAKE_W, BAKE_H, buf)
  renderer.setRenderTarget(null)
  rt.dispose()

  // Restore the editor view.
  scene.overrideMaterial = null
  handleMeshes.forEach(m => (m.visible = true))
  giz.visible = gizVis
  scene.background = prevBg

  // WebGL pixels are bottom-up; flip into a 2D canvas.
  const cv = document.createElement('canvas')
  cv.width = BAKE_W; cv.height = BAKE_H
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(BAKE_W, BAKE_H)
  for (let y = 0; y < BAKE_H; y++) {
    const src = (BAKE_H - 1 - y) * BAKE_W * 4
    const dst = y * BAKE_W * 4
    img.data.set(buf.subarray(src, src + BAKE_W * 4), dst)
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL('image/png')
}

function currentState(): PoseState {
  return {
    rotations: serializeRotations(joints),
    camera: {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [orbit.target.x, orbit.target.y, orbit.target.z],
    },
  }
}

// ── Generate ─────────────────────────────────────────────────────────────────
async function generate() {
  errorMsg.value = ''
  if (!characterUrl.value) { errorMsg.value = 'Wire a character image into the node first.'; return }
  try {
    const charImg = await loadImage(characterUrl.value)
    const cap = capDims(charImg.naturalWidth || 768, charImg.naturalHeight || 1024)
    const charData = imageToDataUrl(charImg, cap.w, cap.h)
    // Condition on the NORMAL render — it encodes facing direction unambiguously
    // so the model follows body rotation (the gray blob / depth don't; see spike).
    const condData = bake('normal')
    const imgs = await inpaint.pose(charData, condData, prompt.value.trim(), { count: 1 })
    results.value = imgs
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.message || 'Generation failed'
  }
}

// ── Multi-view: a character sheet for image-to-3D ────────────────────────────
// Keep the current pose; capture canonical angles (front/right/back/left) by
// orbiting a bake camera around the figure, generate the character in each, and
// drop them as standalone artifact-image nodes (a sheet to feed Hunyuan3D etc.).
// Each view is generated independently, so cross-view consistency is best-effort
// (the prompt asks for it) — the #1 caveat for downstream mesh quality.
// Per-view facing is spelled out explicitly: nano-banana reads front/back fine
// but won't reliably tell a left profile from a right one (both default to the
// same direction), so we name the frame-facing direction for each side.
const MULTI_VIEWS: Array<{ label: string; az: number; facing: string }> = [
  { label: 'front', az: 0, facing: 'a FRONT view: the character faces the camera directly, looking straight at the viewer' },
  { label: 'right', az: 90, facing: "an exact SIDE PROFILE from the character's RIGHT side — the character faces toward the LEFT edge of the frame" },
  { label: 'back', az: 180, facing: 'a BACK view: the character faces directly AWAY from the camera (we see their back and the back of their head)' },
  { label: 'left', az: 270, facing: "an exact SIDE PROFILE from the character's LEFT side — the character faces toward the RIGHT edge of the frame (mirror image of the right-side view)" },
]
async function generateMultiView() {
  errorMsg.value = ''
  if (!characterUrl.value) { errorMsg.value = 'Wire a character image into the node first.'; return }
  multiBusy.value = true
  try {
    const charImg = await loadImage(characterUrl.value)
    const cap = capDims(charImg.naturalWidth || 768, charImg.naturalHeight || 1024)
    const charData = imageToDataUrl(charImg, cap.w, cap.h)
    const t = orbit.target
    const R = Math.min(6, Math.max(2.5, camera.position.distanceTo(t)))
    const elev = 6 * Math.PI / 180
    const out: Array<{ label: string; filename: string }> = []
    for (const view of MULTI_VIEWS) {
      multiStatus.value = `Rendering ${view.label}… (${out.length + 1}/${MULTI_VIEWS.length})`
      const az = view.az * Math.PI / 180
      const cam = camera.clone()
      cam.aspect = BAKE_W / BAKE_H
      cam.position.set(
        t.x + R * Math.cos(elev) * Math.sin(az),
        t.y + R * Math.sin(elev),
        t.z + R * Math.cos(elev) * Math.cos(az),
      )
      cam.lookAt(t)
      cam.updateProjectionMatrix()
      const cond = bake('normal', cam)
      const p = `${prompt.value.trim()} This is ${view.facing}. It is one frame of a multi-view 3D turntable — keep the character IDENTICAL across all views (same face, hair, clothing, colours, proportions), centered, full body, plain neutral background.`
      const imgs = await inpaint.pose(charData, cond, p, { count: 1 })
      if (imgs[0]) out.push({ label: view.label, filename: await inpaint.uploadDataUrl(imgs[0], `pose_view_${view.label}_${props.nodeId}`) })
    }
    // Stash the pose on the node so it shows the mannequin.
    setWidget('mannequin_image', await inpaint.uploadDataUrl(bake('gray'), `pose_mannequin_${props.nodeId}`))
    setWidget('pose_cond_image', await inpaint.uploadDataUrl(bake('normal'), `pose_cond_${props.nodeId}`))
    setWidget('pose_state', JSON.stringify(currentState()))
    window.dispatchEvent(new CustomEvent('comfynext:poseMultiResult', { detail: { nodeId: props.nodeId, views: out } }))
    emit('close')
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.message || 'Multi-view generation failed'
  } finally {
    multiBusy.value = false; multiStatus.value = ''
  }
}

// ── Apply: store the pose on THIS node, send the result downstream ───────────
// The pose node only holds the mannequin pose; the generated character flows out
// of the IMAGE output into a (created-if-missing) artifact-image node. We still
// stash result_image on the pose node so a graph "Run" returns it for free.
async function applyResult(dataUrl: string) {
  const n = node.value
  if (!n) return
  errorMsg.value = ''
  try {
    // Gray for the node thumbnail; normal map for the model (graph-run parity).
    const mannequinFn = await inpaint.uploadDataUrl(bake('gray'), `pose_mannequin_${props.nodeId}`)
    const condFn = await inpaint.uploadDataUrl(bake('normal'), `pose_cond_${props.nodeId}`)
    const resultFn = await inpaint.uploadDataUrl(dataUrl, `pose_result_${props.nodeId}`)
    setWidget('pose_state', JSON.stringify(currentState()))
    setWidget('mannequin_image', mannequinFn)
    setWidget('pose_cond_image', condFn)
    setWidget('result_image', resultFn)
    setWidget('prompt', prompt.value.trim())
    // Route the result to a downstream artifact-image node (canvas owns node/edge
    // creation). The pose node itself shows only the mannequin.
    window.dispatchEvent(new CustomEvent('comfynext:poseResult', {
      detail: { nodeId: props.nodeId, filename: resultFn },
    }))
    emit('close')
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.message || 'Could not save result'
  }
}

// Save the pose (and its mannequin preview) without generating.
async function savePoseOnly() {
  const n = node.value
  if (!n) return
  try {
    const mannequinFn = await inpaint.uploadDataUrl(bake('gray'), `pose_mannequin_${props.nodeId}`)
    const condFn = await inpaint.uploadDataUrl(bake('normal'), `pose_cond_${props.nodeId}`)
    setWidget('pose_state', JSON.stringify(currentState()))
    setWidget('mannequin_image', mannequinFn)
    setWidget('pose_cond_image', condFn)
    setWidget('prompt', prompt.value.trim())
    emit('close')
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.message || 'Could not save pose'
  }
}

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
  else if (e.key === 'r' || e.key === 'R') control?.setMode('rotate')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  initThree().catch(err => { errorMsg.value = `3D editor failed to load: ${err?.message || err}` })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  cancelAnimationFrame(rafId)
  rafId = 0
  resizeObs?.disconnect()
  renderer?.domElement?.removeEventListener('pointerdown', onPointerDown)
  renderer?.domElement?.removeEventListener('pointerup', onPointerUp)
  try {
    control?.dispose?.(); orbit?.dispose?.()
    // Explicitly drop the WebGL context — dispose() alone can leave it lingering,
    // and browsers cap concurrent contexts (~16); evicting old ones flickers the
    // page's other canvases. forceContextLoss frees it immediately.
    renderer?.forceContextLoss?.()
    renderer?.dispose?.()
  } catch { /* ignore */ }
  if (renderer?.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
  renderer = null; scene = null; camera = null; orbit = null; control = null; gizmo = null
})
</script>

<template>
  <div class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" @click.self="emit('close')">
    <div class="w-full h-full max-w-[1200px] max-h-[860px] bg-[#0a0a0a] rounded-xl border border-white/10 shadow-2xl flex text-white/85 overflow-hidden">
      <!-- 3D stage -->
      <div class="flex-1 relative bg-[#0d0d0f]">
        <div ref="stageRef" class="absolute inset-0" />
        <button class="absolute top-4 right-4 z-10 flex items-center justify-center size-8 rounded-md bg-white/5 hover:bg-white/10 cursor-pointer" title="Close (Esc)" @click="emit('close')">
          <X class="size-4" />
        </button>
        <div v-if="!ready" class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 class="size-7 animate-spin text-white/50" />
        </div>
        <!-- Hints -->
        <div class="absolute bottom-3 left-3 text-[10px] text-white/35 leading-relaxed pointer-events-none">
          <div>Drag empty space to orbit · scroll to zoom</div>
          <div>Click a <span class="text-sky-400">limb or joint</span> to select · drag the ring to rotate it</div>
          <div v-if="selectedJoint" class="text-white/55">selected: {{ selectedJoint }}</div>
        </div>
      </div>

      <!-- Controls -->
      <div class="w-80 border-l border-white/10 shrink-0 flex flex-col">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Wand2 class="size-4 text-violet-400" />
          <span class="text-sm font-semibold tracking-tight">Pose Mannequin</span>
        </div>

        <div class="p-4 flex flex-col gap-3 overflow-y-auto">
          <!-- Character status -->
          <div class="flex items-center gap-2 text-[11px]" :class="characterUrl ? 'text-white/55' : 'text-amber-400'">
            <template v-if="characterUrl">
              <img :src="characterUrl" class="size-10 rounded object-cover border border-white/10" draggable="false" />
              <span>Character connected</span>
            </template>
            <template v-else>
              <AlertTriangle class="size-4 shrink-0" />
              <span>No character wired — connect an image to the node's input.</span>
            </template>
          </div>

          <!-- Presets -->
          <div>
            <label class="text-[10px] uppercase tracking-wide text-white/40">Preset</label>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <button v-for="name in presetNames" :key="name"
                class="h-7 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] cursor-pointer"
                @click="applyPreset(name)">{{ name }}</button>
              <button class="h-7 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[11px] cursor-pointer flex items-center gap-1"
                title="Reset to stand" @click="resetPose"><RotateCcw class="size-3" /> Reset</button>
            </div>
          </div>

          <!-- Prompt -->
          <div>
            <label class="text-[10px] uppercase tracking-wide text-white/40">Extra guidance (optional)</label>
            <textarea v-model="prompt" rows="2" placeholder="e.g. dramatic side lighting, keep the red jacket"
              class="mt-1 w-full bg-white/[0.06] rounded-md text-[12px] px-2 py-1.5 outline-none resize-none placeholder:text-white/25" />
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5">
            <button class="flex-1 h-9 rounded-md bg-violet-500/90 hover:bg-violet-500 text-white text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center justify-center gap-1.5"
              :disabled="inpaint.busy.value || !ready || !characterUrl" @click="generate">
              <Loader2 v-if="inpaint.busy.value" class="size-4 animate-spin" />
              <Wand2 v-else class="size-4" />
              {{ inpaint.busy.value ? 'Generating…' : (results.length ? 'Regenerate' : 'Generate') }}
            </button>
            <button class="h-9 px-3 rounded-md bg-white/10 hover:bg-white/15 text-[12px] cursor-pointer disabled:opacity-40"
              :disabled="!ready || multiBusy" title="Save the pose without generating" @click="savePoseOnly">Save pose</button>
          </div>

          <!-- Multi-view (3D character sheet) -->
          <button class="h-9 w-full rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[12px] cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center justify-center gap-1.5"
            :disabled="inpaint.busy.value || multiBusy || !ready || !characterUrl"
            :title="`Generate front/right/back/left views of the character for image-to-3D (${MULTI_VIEWS.length} generations). Tip: start from A-pose or T-pose.`"
            @click="generateMultiView">
            <Loader2 v-if="multiBusy" class="size-4 animate-spin" />
            <Boxes v-else class="size-4" />
            {{ multiBusy ? (multiStatus || 'Generating views…') : 'Generate 3D views' }}
          </button>
          <p v-if="!multiBusy" class="-mt-1.5 text-[10px] text-white/30">4 angles for image-to-3D · best from A-pose / T-pose</p>

          <!-- Results -->
          <div v-if="results.length" class="pt-2 border-t border-white/10">
            <div class="mb-2 text-[11px] uppercase tracking-wide text-white/40">Pick a result</div>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="(img, i) in results" :key="i"
                class="relative group rounded-md overflow-hidden border border-white/10 hover:border-violet-400/80 cursor-pointer"
                @click="applyResult(img)">
                <img :src="img" class="w-full aspect-[3/4] object-cover" draggable="false" />
                <span class="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1"><Check class="size-3" /> Use this</span>
              </button>
            </div>
            <p class="mt-1.5 text-[10px] text-white/30">Click to apply to the node.</p>
          </div>

          <div v-if="errorMsg" class="text-[11px] text-rose-400">{{ errorMsg }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
