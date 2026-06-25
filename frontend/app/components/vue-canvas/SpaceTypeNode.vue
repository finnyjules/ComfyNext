<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Pencil, Sparkles } from 'lucide-vue-next'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { getEffect } from '~/lib/spacetype/effects'
import {
  defaultSpaceTypeState, dimsFromKey, ensureSpaceTypeFont, texOptsFromState,
  type SpaceTypeState,
} from '~/lib/spacetype/state'
import { registerStudioBaker, unregisterStudioBaker } from '~/lib/studio/cascade'
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
  }
}>()

const PREVIEW_W = 204
const MIN_H = 80
const MAX_H = 160

// Live view of the node's saved config (falls back to defaults for a fresh node).
const state = computed<SpaceTypeState>(
  () => (props.data?.properties?.comfynext_spaceType as SpaceTypeState) ?? defaultSpaceTypeState(),
)

function previewHeight(s: SpaceTypeState): number {
  const [cw, ch] = dimsFromKey(s.dimsKey)
  const h = Math.round(PREVIEW_W * ch / cw)
  return Math.max(MIN_H, Math.min(MAX_H, h))
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const previewH = ref(previewHeight(state.value))
// Engine is a plain (non-reactive) handle — never wrap a WebGL renderer in a Vue proxy.
let engine: SpaceTypeEngine | null = null
let raf = 0
let previewStart = 0
const renderError = ref<string | null>(null)

function rebuild() {
  if (!engine) return
  const s = state.value
  engine.setSize(PREVIEW_W, previewH.value)
  engine.setFps(s.fps)
  engine.setLoopDuration(s.loopDuration)
  engine.setBackground(s.transparent, s.bgColor)
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
  const s = state.value
  previewH.value = previewHeight(s)
  engine = new SpaceTypeEngine(canvasEl.value, {
    effect: getEffect(s.effectId), width: PREVIEW_W, height: previewH.value,
    fps: s.fps, loopDuration: s.loopDuration, alpha: s.transparent, bgColor: s.bgColor,
  })
  await ensureSpaceTypeFont(String(s.params.font))
  rebuild()
  startPreview()
  registerStudioBaker(props.id, bakeOutput)
})

// Headless full-res frame for the render cascade (generative — no input). Renders
// frame 0 at the configured output dims, then restores the live preview.
async function bakeOutput(): Promise<Blob | null> {
  if (!engine) return null
  const s = state.value
  const [cw, ch] = dimsFromKey(s.dimsKey)
  stopPreview()
  try {
    await ensureSpaceTypeFont(String(s.params.font))
    engine.setSize(cw, ch)
    engine.setBackground(s.transparent, s.bgColor)
    engine.setEffect(getEffect(s.effectId))
    engine.build(s.params, texOptsFromState(s))
    engine.renderFrame(0, s.params)
    return await engine.frameToBlob()
  } catch (e) {
    console.error('[space-type] bake failed', e); return null
  } finally {
    previewH.value = previewHeight(s)
    rebuild()
    startPreview()
  }
}

onBeforeUnmount(() => {
  stopPreview()
  unregisterStudioBaker(props.id)
  engine?.dispose()
  engine = null
})

// The modal writes config back to node.data.properties on edits — rebuild the
// node preview live when that changes. Debounced so a burst of slider edits
// (deep watch fires per keystroke) coalesces into one rebuild.
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
watch(state, (s) => {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null
    if (!engine) return
    previewH.value = previewHeight(s)
    await ensureSpaceTypeFont(String(s.params.font))
    rebuild()
  }, 80)
}, { deep: true })

const text = computed(() => String(state.value.params.text ?? 'SPACE TYPE'))

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openSpaceType', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Output handle: anchors the provenance edge to a generated Image/Video node. -->
    <Handle
      id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '50%' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Sparkles class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Type Studio</span>
      <span class="ml-auto max-w-[110px] truncate text-[10px] uppercase tracking-wide text-white/40">{{ text }}</span>
    </div>

    <!-- Live animated preview -->
    <div class="relative flex items-center justify-center bg-neutral-950">
      <canvas
        ref="canvasEl"
        class="block w-full"
        :style="{ height: previewH + 'px' }"
      />
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
</template>
