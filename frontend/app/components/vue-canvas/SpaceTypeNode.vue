<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Pencil, Sparkles } from 'lucide-vue-next'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { getEffect } from '~/lib/spacetype/effects'
import {
  defaultSpaceTypeState, dimsFromKey, ensureSpaceTypeFont, texOptsFromState,
  type SpaceTypeState,
} from '~/lib/spacetype/state'
import { DEFAULT_POST } from '~/lib/spacetype/post'
import { loadSpaceDefaults, spaceDefaultFor } from '~/composables/useSpaceDefaults'
import { applySceneToState } from '~/lib/spacetype/scene'
import { registerStudioBaker, unregisterStudioBaker } from '~/lib/studio/cascade'
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
import { makeSpaceTypeFrameSource } from '~/lib/spacetype/frameSource'
import StudioRenderButton from '~/components/vue-canvas/StudioRenderButton.vue'

// Space Type — a frontend-only config node for the client-side Three.js ribbon
// typography editor. No inputs/outputs (no backend class_type), so it never
// enters an executed prompt. The card shows a LIVE animated preview driven by
// the node's saved config; "Edit" (bottom) reopens the SpaceTypeSurface modal
// bound to this node, which writes its config back to node.data.properties.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    properties?: Record<string, any>
    studioBusy?: boolean
    inputs?: { name?: string }[]
  }
}>()

const PREVIEW_W = 204
const MIN_H = 80
const MAX_H = 160
// Supersample factor for the headless bake (render N× then downscale → clean edges).
const BAKE_SS = 2

// Live view of the node's saved config (falls back to defaults for a fresh node).
const state = computed<SpaceTypeState>(
  () => (props.data?.properties?.sailor_spaceType as SpaceTypeState) ?? defaultSpaceTypeState(),
)

// True if the node already had a saved config at mount time; false = fresh node → apply default scene.
const hadSavedConfig = !!props.data?.properties?.sailor_spaceType

function previewHeight(s: SpaceTypeState): number {
  const [cw, ch] = dimsFromKey(s.dimsKey)
  const h = Math.round(PREVIEW_W * ch / cw)
  return Math.max(MIN_H, Math.min(MAX_H, h))
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const previewH = ref(previewHeight(state.value))
// Engine is a plain (non-reactive) handle — never wrap a WebGL renderer in a Vue proxy.
let engine: SpaceTypeEngine | null = null
// A SECOND engine, separate from the card-preview `engine`, dedicated to the
// cross-studio frame source. Lazily created on first pull (ensureHeadless), so a
// Space Type node with no live downstream consumer never pays the extra WebGL
// context. Its own offscreen canvas — never the card's — so the two never fight
// over one canvas at different frame indices (which would ghost the card).
let headlessEngine: SpaceTypeEngine | null = null
let headlessCanvas: HTMLCanvasElement | null = null
let headlessDirty = true   // config changed since the last headless build
let raf = 0
let previewStart = 0
const renderError = ref<string | null>(null)
const webglOk = ref(true)

let io: IntersectionObserver | null = null
let onVisibility: (() => void) | null = null
let onOpen: ((e: Event) => void) | null = null
let onClose: (() => void) | null = null
const gate = { visible: true, tabActive: true, editing: false }

function applyGate() {
  const shouldRun = gate.visible && gate.tabActive && !gate.editing && !!engine && webglOk.value
  if (shouldRun && !raf) startPreview()
  else if (!shouldRun && raf) stopPreview()
}

function rebuild() {
  if (!engine) return
  const s = state.value
  engine.setSize(PREVIEW_W, previewH.value)
  engine.setFps(s.fps)
  engine.setLoopDuration(s.loopDuration)
  engine.setBackground(s.transparent, s.bgColor)
  engine.setProjection(s.projection ?? 'perspective')
  engine.setPost({ ...(s.post ?? DEFAULT_POST) })
  engine.setPan(s.panX ?? 0, s.panY ?? 0)
  // Honor a config effectId change (the deep watch on `state` calls rebuild()).
  engine.setEffect(getEffect(s.effectId))
  engine.build(s.params, texOptsFromState(s))
}

function startPreview() {
  previewStart = 0
  const tick = (ts: number) => {
    if (!engine) return
    if (!previewStart) previewStart = ts
    const s = state.value
    const total = Math.max(1, Math.round(s.fps * s.loopDuration))
    const frame = Math.floor(((ts - previewStart) / 1000) * s.fps) % total
    engine.renderFrame(frame, s.params)
    renderError.value = engine.lastError
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function stopPreview() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

onMounted(async () => {
  if (!canvasEl.value) return

  // Apply a default scene to a fresh node (no saved config) BEFORE building the engine,
  // so state.value already reflects the scene when the engine constructor runs.
  if (!hadSavedConfig) {
    await loadSpaceDefaults()
    const base = defaultSpaceTypeState()
    const scene = spaceDefaultFor(base.effectId)
    if (scene) {
      const merged = applySceneToState(base, scene)
      const n = props.data
      if (n) { (n.properties ||= {}).sailor_spaceType = merged }
    }
  }

  if (!detectWebGL()) { webglOk.value = false; return }
  const s = state.value
  previewH.value = previewHeight(s)
  engine = new SpaceTypeEngine(canvasEl.value, {
    effect: getEffect(s.effectId), width: PREVIEW_W, height: previewH.value,
    fps: s.fps, loopDuration: s.loopDuration, alpha: s.transparent, bgColor: s.bgColor,
    projection: s.projection ?? 'perspective',
  })
  await ensureSpaceTypeFont(String(s.params.font))
  rebuild()
  registerStudioBaker(props.id, bakeOutput)
  // Modal-independent live frame source: a directly-wired downstream Shader Studio
  // pulls frames from here even when this node's editor is closed. Uses its OWN
  // lazily-created headless engine (ensureHeadless), not the card-preview `engine`.
  // renderAt honors the requested w/h, so a chained export is full-resolution.
  registerStudioFrameSource(props.id, makeSpaceTypeFrameSource({
    getClock: () => {
      const s = state.value
      const [cw, ch] = dimsFromKey(s.dimsKey)
      return { duration: s.loopDuration, fps: s.fps, width: cw, height: ch }
    },
    renderAt: (t01, w, h) => {
      const eng = ensureHeadless(w, h)
      if (!eng || !headlessCanvas) return null
      const s = state.value
      eng.setSize(w, h)   // covers a scale change between pulls (same aspect, no rebuild)
      const total = Math.max(1, Math.round(s.fps * s.loopDuration))
      const frame = ((Math.round(t01 * total) % total) + total) % total
      eng.renderFrame(frame, s.params)
      return headlessCanvas
    },
  }))
  io = new IntersectionObserver(([entry]) => { gate.visible = !!entry?.isIntersecting; applyGate() }, { threshold: 0.01 })
  if (canvasEl.value?.parentElement) io.observe(canvasEl.value.parentElement)
  onVisibility = () => { gate.tabActive = !document.hidden; applyGate() }
  document.addEventListener('visibilitychange', onVisibility)
  onOpen = (e: Event) => { if ((e as CustomEvent).detail?.nodeId === props.id) { gate.editing = true; applyGate() } }
  onClose = () => { gate.editing = false; applyGate() }
  window.addEventListener('sailor:openSpaceType', onOpen as EventListener)
  window.addEventListener('sailor:closeSpaceType', onClose as EventListener)
  applyGate()
})

// Lazily build (and keep in sync) the dedicated frame-source engine. Called only
// from the frame source's renderAt, so nothing is created until a downstream
// consumer actually pulls. `headlessDirty` defers geometry rebuilds to the next
// pull instead of rebuilding an offscreen engine per config keystroke.
function ensureHeadless(w: number, h: number): SpaceTypeEngine | null {
  if (!detectWebGL()) return null
  if (!headlessEngine) {
    headlessCanvas = document.createElement('canvas')
    const s = state.value
    // Construct at the requested size, not the preview size: aspect-dependent
    // effects (string/contour/tunnel/…) read env.width/height at BUILD time.
    headlessEngine = new SpaceTypeEngine(headlessCanvas, {
      effect: getEffect(s.effectId), width: w, height: h,
      fps: s.fps, loopDuration: s.loopDuration, alpha: s.transparent, bgColor: s.bgColor,
      projection: s.projection ?? 'perspective',
    })
    headlessDirty = true
    // Card mount usually primes the font first (shared global cache), but if a pull
    // races ahead, force one rebuild once the font resolves so text isn't baked with
    // a fallback face. Config-driven font changes are primed by the card's own await.
    void ensureSpaceTypeFont(String(s.params.font)).then(() => { headlessDirty = true })
  }
  if (headlessDirty) {
    const s = state.value
    headlessEngine.setSize(w, h)   // BEFORE build — geometry layout reads the size
    headlessEngine.setBackground(s.transparent, s.bgColor)
    headlessEngine.setProjection(s.projection ?? 'perspective')
    headlessEngine.setPost({ ...(s.post ?? DEFAULT_POST) })
    headlessEngine.setPan(s.panX ?? 0, s.panY ?? 0)
    headlessEngine.setFps(s.fps)
    headlessEngine.setLoopDuration(s.loopDuration)
    headlessEngine.setEffect(getEffect(s.effectId))
    headlessEngine.build(s.params, texOptsFromState(s))
    headlessDirty = false
  }
  return headlessEngine
}

// Headless full-res frame for the render cascade (generative — no input). Renders
// frame 0 at the configured output dims, then restores the live preview.
async function bakeOutput(): Promise<Blob | null> {
  if (!engine) return null
  const s = state.value
  const [cw, ch] = dimsFromKey(s.dimsKey)
  stopPreview()
  try {
    await ensureSpaceTypeFont(String(s.params.font))
    engine.setSize(cw * BAKE_SS, ch * BAKE_SS)
    engine.setBackground(s.transparent, s.bgColor)
    engine.setEffect(getEffect(s.effectId))
    engine.build(s.params, texOptsFromState(s))
    engine.renderFrame(0, s.params)
    return await engine.frameToBlob(cw, ch)
  } catch (e) {
    console.error('[space-type] bake failed', e); return null
  } finally {
    previewH.value = previewHeight(s)
    rebuild()
    applyGate()
  }
}

onBeforeUnmount(() => {
  stopPreview()
  io?.disconnect(); io = null
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  if (onOpen) window.removeEventListener('sailor:openSpaceType', onOpen as EventListener)
  if (onClose) window.removeEventListener('sailor:closeSpaceType', onClose as EventListener)
  unregisterStudioBaker(props.id)
  unregisterStudioFrameSource(props.id)
  engine?.dispose()
  engine = null
  headlessEngine?.dispose()
  headlessEngine = null
  headlessCanvas = null
})

// The modal writes config back to node.data.properties on edits — rebuild the
// node preview live when that changes. Debounced so a burst of slider edits
// (deep watch fires per keystroke) coalesces into one rebuild.
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
watch(state, (s) => {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  headlessDirty = true   // next frame-source pull rebuilds the (lazy) headless engine
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null
    if (!engine) return
    previewH.value = previewHeight(s)
    await ensureSpaceTypeFont(String(s.params.font))
    rebuild()
  }, 80)
}, { deep: true })

const text = computed(() => String(state.value.params.text ?? 'Sailor'))

// Index of the optional `vars` input a Collection's VARS output wires into.
// Rendering its Handle (below) is what lets that edge anchor and survive reload.
const varsInputIndex = computed(() =>
  ((props.data?.inputs as { name?: string }[] | undefined) ?? []).findIndex(i => i?.name === 'vars'))

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openSpaceType', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <!-- Ports live OUTSIDE the card: the card clips its own content (overflow-hidden),
       which would otherwise cut the port dots and their hit areas in half — the bug
       that stopped Type Studio connecting. As siblings they tuck in behind it.
       Mirrors GradientStudioNode / the shared port migration. -->
  <div class="relative w-fit">
    <!-- Variables input: a Collection's VARS output wires here. Rendering this port
         lets the VARS edge anchor so it survives reload (fixes edge-lost-on-restart). -->
    <VueCanvasNodePort
      v-if="varsInputIndex >= 0"
      :id="`input-${varsInputIndex}`" type="target" side="left" :index="0"
      data-type="VARS" label="variables"
    />

    <!-- Output: anchors the provenance edge to a generated Image/Video node. -->
    <VueCanvasNodePort
      id="output-0" type="source" side="right" :index="0"
      data-type="IMAGE" label="output"
    />

    <div
      class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
      @dblclick.stop="openEditor"
    >
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Sparkles class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Type Studio</span>
      <span class="ml-auto max-w-[110px] truncate text-[10px] uppercase tracking-wide text-white/40">{{ text }}</span>
    </div>

    <!-- Live animated preview -->
    <div class="relative flex items-center justify-center bg-neutral-950">
      <canvas v-if="webglOk" ref="canvasEl" class="block w-full" :style="{ height: previewH + 'px' }" />
      <div v-else class="flex w-full items-center justify-center px-3 text-center text-[10px] text-white/40"
           :style="{ height: previewH + 'px' }">3D preview unavailable</div>
      <div v-if="renderError"
           class="absolute inset-x-2 bottom-2 rounded border border-amber-400/30 bg-black/70 px-2 py-1 text-[9px] text-amber-200/90">
        Render error
      </div>
    </div>

    <!-- Render + Edit (bottom) -->
    <div class="border-t border-white/10 p-2 flex items-center gap-1.5">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
      <StudioRenderButton class="flex-1" :node-id="id" :busy="!!data?.studioBusy" />
    </div>
    </div>
  </div>
</template>
