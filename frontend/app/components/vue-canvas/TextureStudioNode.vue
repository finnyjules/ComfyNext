<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Layers, Pencil } from 'lucide-vue-next'
import { textureFx } from '~/lib/texturefx/renderer'
import { preloadStylize, stylizeTile } from '~/lib/texturefx/stylize'
import { textureDefaults } from '~/lib/texturefx/controls'
import { loadRaster, getRaster } from '~/lib/texturefx/raster'
import type { Params } from '~/lib/spacetype/effect'

// Texture Studio — a frontend-only config node (no backend class_type, never
// executes). The card shows a live seamless-tile preview from the saved params;
// "Edit" opens the full TextureStudioSurface bound to this node, which writes
// its params back to node.data.properties.comfynext_textureStudio.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    properties?: Record<string, any>
  }
}>()

const PREVIEW_W = 220
const PREVIEW_H = 148 // ~3:2

const params = computed<Params>(() => {
  // Merge over defaults so nodes saved before newer keys existed (e.g. mode/
  // tileFamily) still render — symmetric with the surface's loadParams().
  const saved = props.data?.properties?.comfynext_textureStudio as Params | undefined
  return saved ? { ...textureDefaults(), ...saved } : textureDefaults()
})

const canvasEl = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)

function renderFrame() {
  const canvas = canvasEl.value
  if (!canvas) return
  if (canvas.width !== PREVIEW_W || canvas.height !== PREVIEW_H) {
    canvas.width = PREVIEW_W
    canvas.height = PREVIEW_H
  }
  try {
    const base = textureFx.render(params.value, PREVIEW_W, PREVIEW_H, 0)
    const out = stylizeTile(base, params.value, PREVIEW_W, PREVIEW_H)
    canvas.getContext('2d')!.drawImage(out, 0, 0)
    glError.value = null
  }
  catch (e: any) {
    glError.value = String(e?.message ?? e)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(params, () => {
  if (timer) clearTimeout(timer)
  const p = params.value
  if (String(p.mode) === 'raster' && p.rasterSrc && !getRaster(String(p.rasterSrc))) {
    loadRaster(String(p.rasterSrc)).then(renderFrame).catch(() => {})
  }
  timer = setTimeout(renderFrame, 60)
}, { deep: true })

onMounted(() => {
  renderFrame()
  // Stylize effects load async; re-render the thumbnail once they're ready.
  preloadStylize().then(renderFrame).catch(() => {})
  // Restore a saved raster image so the card preview renders correctly on load.
  const p = params.value
  if (String(p.mode) === 'raster' && p.rasterSrc && !getRaster(String(p.rasterSrc))) {
    loadRaster(String(p.rasterSrc)).then(renderFrame).catch(() => {})
  }
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openTextureStudio', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Output handle: anchors the provenance edge to a generated Image node. -->
    <Handle
      id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '50%' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Layers class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Pattern Studio</span>
    </div>

    <!-- Live seamless preview -->
    <div class="flex items-center justify-center bg-neutral-950">
      <canvas ref="canvasEl" class="block w-full" :style="{ height: PREVIEW_H + 'px' }" />
    </div>
    <div v-if="glError" class="truncate px-3 py-1 text-[10px] text-red-300/90" :title="glError">{{ glError }}</div>

    <!-- Edit -->
    <div class="border-t border-white/10 p-2">
      <button
        class="flex w-full items-center justify-center gap-1.5 rounded bg-white/10 px-2 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
    </div>
  </div>
</template>
