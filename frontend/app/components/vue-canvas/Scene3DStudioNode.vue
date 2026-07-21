<script setup lang="ts">
// 3D Studio node card. Unlike the frontend-only studios this is a real backend
// node (Scene3DStudio): the card shows the last baked beauty render straight
// from the persisted `beauty_image` widget (no ephemeral output event needed)
// and "Edit" opens Scene3DStudioSurface, which writes the bakes back into the
// widgets that execute() replays on Run.
import { computed, onBeforeUnmount, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Box, Pencil } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'
import { parseDoc } from '~/lib/scene3d/config'
import { SceneEngine } from '~/lib/scene3d/engine'
import { sceneHasMotion, renderMotionFrame } from '~/lib/scene3d/motion/render'
import { makeScene3DFrameSource } from '~/lib/scene3d/motion/frameSource'
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    inputs?: { name: string; type: string; link: number | null }[]
    outputs?: { name: string; type: string; links: number[] | null }[]
    widgetsValues?: any[]
    widgetDefs?: any[]
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const imageColor = computed(() => getTypeColor('IMAGE'))
const stringColor = computed(() => getTypeColor('STRING'))

function widgetStr(name: string): string {
  const i = props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
  return i >= 0 ? String(props.data.widgetsValues?.[i] ?? '') : ''
}

// Persisted last bake — the beauty_image widget the surface writes on close.
const thumbUrl = computed(() => {
  const f = widgetStr('beauty_image')
  return f ? `/view?${new URLSearchParams({ filename: f, type: 'input' })}` : null
})

// glb_url input slot — rendering this Handle lets an upstream URL edge anchor
// and survive reload.
const glbInIdx = computed(() => {
  const i = props.data.inputs?.findIndex((x) => x.name === 'glb_url') ?? -1
  return i >= 0 ? i : 0
})

// Output ports, keyed by real slot index so `output-N` handle ids match the
// backend node's output order (beauty/depth/normal). Falls back to the static
// list before object_info has populated data.outputs.
const outputPorts = computed(() => {
  const outs = props.data.outputs
  if (Array.isArray(outs) && outs.length) {
    return outs.map((o, i) => ({ id: `output-${i}`, label: o.name || `out ${i}` }))
  }
  return ['beauty', 'depth', 'normal'].map((name, i) => ({ id: `output-${i}`, label: name }))
})

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

function ensureHeadless(w: number, h: number): SceneEngine | null {
  if (typeof document === 'undefined') return null
  if (!headlessCanvas) headlessCanvas = document.createElement('canvas')
  if (!headlessEngine) {
    try { headlessEngine = new SceneEngine(headlessCanvas, w, h) }
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

watch(sceneDoc, syncRegistration, { immediate: true, deep: true })

onBeforeUnmount(() => {
  if (registered) unregisterStudioFrameSource(props.id)
  headlessEngine?.dispose()
  headlessEngine = null
  headlessCanvas = null
})
</script>

<template>
  <div
    class="relative w-[240px] rounded-xl border border-white/10 bg-neutral-900/95 text-white shadow-lg"
    :class="{ 'opacity-45 grayscale': isMuted, 'opacity-85': isBypassed }"
    @dblclick.stop="openEditor"
  >
    <!-- glb_url input: anchors an upstream URL edge to this node. -->
    <Handle
      :id="`input-${glbInIdx}`" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: stringColor, top: '22px' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Box class="h-4 w-4 shrink-0 text-sky-400" />
      <span class="flex-1 truncate text-xs font-medium text-white/90">{{ data.title || '3D Studio' }}</span>
      <button
        type="button" title="Edit scene"
        class="nopan nodrag rounded bg-white/10 p-1 hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3.5 w-3.5 text-white/80" />
      </button>
    </div>

    <!-- Last baked beauty render (persisted beauty_image widget). -->
    <div class="mx-2 my-2 aspect-square overflow-hidden rounded-lg bg-black/40">
      <img v-if="thumbUrl" :src="thumbUrl" class="h-full w-full object-cover" alt="" />
      <button
        v-else type="button"
        class="nopan nodrag flex h-full w-full flex-col items-center justify-center gap-1 text-white/35 hover:text-white/60"
        @click.stop="openEditor"
      >
        <Box class="h-6 w-6" />
        <span class="text-[10px]">Edit scene</span>
      </button>
    </div>

    <!-- Output ports: beauty / depth / normal (IMAGE). -->
    <div class="flex flex-col gap-0.5 border-t border-white/10 py-2">
      <div
        v-for="port in outputPorts" :key="port.id"
        class="relative flex h-6 items-center justify-end pr-3 text-[10px] text-white/50"
      >
        {{ port.label }}
        <Handle
          :id="port.id" type="source" :position="Position.Right"
          class="!h-3 !w-3 !rounded-full !border-2 !bg-[#1a1a1a]"
          :style="{ borderColor: imageColor }"
        />
      </div>
    </div>
  </div>
</template>
