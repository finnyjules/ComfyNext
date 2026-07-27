<script setup lang="ts">
// 3D Studio node card. Unlike the frontend-only studios this is a real backend
// node (Scene3DStudio): the card shows the last baked beauty render straight
// from the persisted `beauty_image` widget (no ephemeral output event needed)
// and "Edit" opens Scene3DStudioSurface, which writes the bakes back into the
// widgets that execute() replays on Run.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Box, Pencil } from 'lucide-vue-next'
import { minHeightForPorts } from '~/lib/canvas/portLayout'
import { parseDoc } from '~/lib/scene3d/config'
import { SceneEngine } from '~/lib/scene3d/engine'
import { renderPasses } from '~/lib/scene3d/passes'
import { sceneHasMotion, renderMotionFrame } from '~/lib/scene3d/motion/render'
import { makeScene3DFrameSource } from '~/lib/scene3d/motion/frameSource'
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
import { registerScene3DRebaker, unregisterScene3DRebaker } from '~/lib/scene3d/rebake'
import StudioRenderButton from '~/components/vue-canvas/StudioRenderButton.vue'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    studioBusy?: boolean
    inputs?: { name: string; type: string; link: number | null }[]
    outputs?: { name: string; type: string; links: number[] | null }[]
    widgetsValues?: any[]
    widgetDefs?: any[]
  }
}>()

const inpaint = useInpaint()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)

function widgetStr(name: string): string {
  const i = props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
  return i >= 0 ? String(props.data.widgetsValues?.[i] ?? '') : ''
}
function setWidget(name: string, value: string): void {
  const i = props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
  if (i >= 0 && Array.isArray(props.data.widgetsValues)) props.data.widgetsValues[i] = value
}

// Persisted last bake — the beauty_image widget the surface writes on close.
const thumbUrl = computed(() => {
  const f = widgetStr('beauty_image')
  return f ? `/view?${new URLSearchParams({ filename: f, type: 'input' })}` : null
})

// glb_url input slot — rendering this port lets an upstream URL edge anchor
// and survive reload.
const glbInIdx = computed(() => {
  const i = props.data.inputs?.findIndex((x) => x.name === 'glb_url') ?? -1
  return i >= 0 ? i : 0
})
const glbInType = computed(() => props.data.inputs?.[glbInIdx.value]?.type || 'STRING')

// Output ports, keyed by real slot index so `output-N` handle ids match the
// backend node's output order (beauty/depth/normal). Falls back to the static
// list before object_info has populated data.outputs.
const outputPorts = computed(() => {
  const outs = props.data.outputs
  if (Array.isArray(outs) && outs.length) {
    return outs.map((o, i) => ({ id: `output-${i}`, label: o.name || `out ${i}`, type: o.type || 'IMAGE' }))
  }
  return ['beauty', 'depth', 'normal'].map((name, i) => ({ id: `output-${i}`, label: name, type: 'IMAGE' }))
})

// The card must stay tall enough to enclose its port stack (3 outputs grow
// downward from the vertical midpoint), same rule every other node uses.
const portsMinHeight = computed(() => minHeightForPorts(Math.max(1, outputPorts.value.length)))

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openScene3DStudio', { detail: { nodeId: props.id } }))
}

// Reactive scene doc — re-parses whenever the widget changes (edits made in the
// Scene3DStudioSurface modal write back into `scene_state`).
const sceneDoc = computed(() => parseDoc(widgetStr('scene_state')))

// Modal-independent live frame source: a directly-wired downstream Frame pulls
// frames from here even when this node's editor is closed. Lazily builds a
// headless SceneEngine ONLY when the scene actually has motion, so an idle 3D
// node wired to a Frame stays a still and never opens a WebGL context.
let headlessCanvas: HTMLCanvasElement | null = null
let headlessEngine: SceneEngine | null = null
let registered = false
// Wall-clock mount time for the headless engine's OWN shaderFill field clock — mirrors
// Scene3DStudioSurface's `scene3dMountedAt` (Item 5, final review). Reset each time the
// headless engine is (re)created, since a fresh engine's fields should animate from a
// fresh t=0 rather than inheriting whatever time had already elapsed on the card.
let headlessMountedAt = 0

function ensureHeadless(w: number, h: number): SceneEngine | null {
  if (typeof document === 'undefined') return null
  if (!headlessCanvas) headlessCanvas = document.createElement('canvas')
  if (!headlessEngine) {
    try { headlessEngine = new SceneEngine(headlessCanvas, w, h); headlessMountedAt = performance.now() }
    catch { headlessEngine = null; return null }
  }
  headlessEngine.setSize(w, h)
  return headlessEngine
}

function syncRegistration() {
  const doc = sceneDoc.value
  const animated = sceneHasMotion(doc)
  if (animated && !registered) {
    registerStudioFrameSource(props.id, makeScene3DFrameSource({
      getClock: () => {
        const d = sceneDoc.value
        return { duration: d.motion.duration, fps: d.motion.fps, width: d.output.width, height: d.output.height }
      },
      renderAt: (t01, w, h) => {
        const eng = ensureHeadless(w, h)
        if (!eng) return null
        return renderMotionFrame(eng, sceneDoc.value, t01)
      },
    }))
    registered = true
  } else if (!animated && registered) {
    unregisterStudioFrameSource(props.id)
    registered = false
  }
}

// Live card thumbnail: render the CURRENT scene client-side (geometry + materials +
// post FX) so the card is WYSIWYG rather than a stale bake. Debounced; the transient
// engine is disposed afterwards UNLESS the frame source (animated scene) is keeping one
// alive — so an idle static node holds no WebGL context. Purely cosmetic: the committed
// beauty_image (what execute() replays on Run) still updates on Render / editor close.
const livePreviewUrl = ref<string | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null
function renderPreview(): void {
  if (typeof document === 'undefined') return
  const doc = sceneDoc.value
  if (!doc.objects.length) { livePreviewUrl.value = null; return }
  const scale = Math.min(1, 384 / Math.max(doc.output.width, doc.output.height))
  const w = Math.max(1, Math.round(doc.output.width * scale))
  const h = Math.max(1, Math.round(doc.output.height * scale))
  const eng = ensureHeadless(w, h)
  if (!eng) return
  try { livePreviewUrl.value = renderMotionFrame(eng, doc, 0).toDataURL('image/png') }
  catch { /* transient WebGL hiccup — keep the previous preview */ }
  finally {
    // Free the context when nothing else needs it (no active frame source).
    if (!registered) { eng.dispose(); headlessEngine = null; headlessCanvas = null }
  }
}
function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 180)
}

watch(sceneDoc, () => { syncRegistration(); schedulePreview() }, { immediate: true, deep: true })

// Footer "Render" (StudioRenderButton → sailor:studioRender → VueNodeCanvas's
// handler, which calls this for Scene3DStudio nodes): re-bake the three passes
// headlessly from the persisted scene and stamp the widgets, WITHOUT opening the
// editor. Mirrors Scene3DStudioSurface.bake() but on this node's own headless
// engine. Uploads all three before touching any widget so a mid-bake failure
// never leaves a mismatched pass set. The card thumbnail (beauty_image) then
// updates reactively; the handler runs the backend downstream afterwards.
async function rebakePasses(): Promise<void> {
  const doc = sceneDoc.value
  const { width, height } = doc.output
  const eng = ensureHeadless(width, height)
  if (!eng) throw new Error('WebGL unavailable')
  eng.syncFromDoc(doc)
  eng.applyCameraFromDoc(doc)
  // Item 5 (final review): same live elapsed-seconds convention as
  // Scene3DStudioSurface's bake() — bakes a shaderFill field at the headless engine's
  // own current moment instead of always freezing it at t=0.
  const passes = await renderPasses(eng, doc, (performance.now() - headlessMountedAt) / 1000)
  const [beauty, depth, normal] = await Promise.all([
    inpaint.uploadDataUrl(passes.beauty, `scene3d_beauty_${props.id}`),
    inpaint.uploadDataUrl(passes.depth, `scene3d_depth_${props.id}`),
    inpaint.uploadDataUrl(passes.normal, `scene3d_normal_${props.id}`),
  ])
  setWidget('beauty_image', beauty)
  setWidget('depth_image', depth)
  setWidget('normal_image', normal)
}

onMounted(() => registerScene3DRebaker(props.id, rebakePasses))

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
  unregisterScene3DRebaker(props.id)
  if (registered) unregisterStudioFrameSource(props.id)
  headlessEngine?.dispose()
  headlessEngine = null
  headlessCanvas = null
})
</script>

<template>
  <!-- Ports are siblings of the card (not children) so the card's opaque
       background occludes each dot's inner half and they read as tucked in
       behind the node — the shared VueCanvasNodePort treatment every node uses.
       glb_url input on the left; beauty/depth/normal outputs stacked down the
       right from the vertical midpoint. -->
  <div class="relative w-fit">
    <VueCanvasNodePort
      :id="`input-${glbInIdx}`" type="target" side="left" :index="0"
      :data-type="glbInType" label="glb_url"
    />
    <VueCanvasNodePort
      v-for="(port, i) in outputPorts" :key="port.id"
      :id="port.id" type="source" side="right" :index="i"
      :data-type="port.type" :label="port.label"
    />

    <div
      class="relative z-10 w-[240px] rounded-xl border border-white/10 bg-neutral-900/95 text-white shadow-lg"
      :class="{ 'opacity-45 grayscale': isMuted, 'opacity-85': isBypassed }"
      :style="{ minHeight: `${portsMinHeight}px` }"
      @dblclick.stop="openEditor"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Box class="h-4 w-4 shrink-0 text-sky-400" />
        <span class="flex-1 truncate text-xs font-medium text-white/90">{{ data.title || '3D Studio' }}</span>
      </div>

      <!-- Live client-side preview of the current scene (WYSIWYG, incl. post FX);
           falls back to the last baked beauty_image, then the empty-scene prompt. -->
      <div class="mx-2 my-2 aspect-square overflow-hidden rounded-lg bg-black/40">
        <img v-if="livePreviewUrl || thumbUrl" :src="livePreviewUrl || thumbUrl || undefined" class="h-full w-full object-cover" alt="" />
        <button
          v-else type="button"
          class="nopan nodrag flex h-full w-full flex-col items-center justify-center gap-1 text-white/35 hover:text-white/60"
          @click.stop="openEditor"
        >
          <Box class="h-6 w-6" />
          <span class="text-[10px]">Edit scene</span>
        </button>
      </div>

      <!-- Edit + Render. Render re-bakes the three passes headlessly (no server
           renderer) then runs the backend downstream — see rebakePasses. -->
      <div class="mx-2 mb-2 flex items-center gap-1.5">
        <button
          class="nopan nodrag flex flex-1 items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
          @click.stop="openEditor"
        >
          <Pencil class="h-3 w-3" /> Edit
        </button>
        <StudioRenderButton class="flex-1" :node-id="id" :busy="!!data?.studioBusy" />
      </div>
    </div>
  </div>
</template>
