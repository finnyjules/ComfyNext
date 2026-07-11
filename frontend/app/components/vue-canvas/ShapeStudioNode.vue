<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Gem, Pencil } from 'lucide-vue-next'

// Shape Studio — a frontend-only config node (no backend class_type, never
// executes). Modeled on GradientStudioNode.vue/TextureStudioNode.vue, but
// unlike those studios (which render their preview with a cheap headless 2D
// canvas function), Shape Studio's engine is a full Three.js WebGL scene tied
// to a live <canvas> (see ShapeStudioSurface.vue / lib/shapefx/engine.ts) —
// too heavy to mount one instance per card on the canvas, and there's no
// headless bake path outside the open Surface. So this card shows the last
// exported PNG (learned from the same `sailor:shapeStudioOutput` event the
// Surface dispatches on export) instead of a live re-render, and — like
// LipSyncStudioNode — doesn't register a studio-cascade baker or render a
// StudioRenderButton. "Edit" opens the full ShapeStudioSurface bound to this
// node, which writes its config back to node.data.properties.sailor_shapeStudio.
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

// Last exported filename, learned live from this node's own output event —
// not persisted, so it resets on reload (acceptable v1: "if present").
const lastExportedFile = ref<string | null>(null)
const thumbUrl = computed(() =>
  lastExportedFile.value
    ? `/view?${new URLSearchParams({ filename: lastExportedFile.value, type: 'input' })}`
    : null,
)

function onOutput(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail || String(detail.sourceNodeId) !== String(props.id)) return
  const filename = detail.widgetOverrides?.image
  if (filename) lastExportedFile.value = String(filename)
}

onMounted(() => window.addEventListener('sailor:shapeStudioOutput', onOutput))
onBeforeUnmount(() => window.removeEventListener('sailor:shapeStudioOutput', onOutput))

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openShapeStudio', { detail: { nodeId: props.id } }))
}

// Index of the optional `vars` input a Collection's VARS output wires into.
// Rendering its Handle (below) is what lets that edge anchor and survive reload.
const varsInputIndex = computed(() =>
  ((props.data?.inputs as { name?: string }[] | undefined) ?? []).findIndex(i => i?.name === 'vars'))
</script>

<template>
  <div
    class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Variables input: a Collection's VARS output wires here. Rendering this Handle
         lets the VARS edge anchor so it survives reload (fixes edge-lost-on-restart). -->
    <Handle
      v-if="varsInputIndex >= 0"
      :id="`input-${varsInputIndex}`" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-[#f472b6]/60 !bg-[#1a1a1a]"
      :style="{ top: '50%' }"
    />

    <!-- Output handle: anchors the provenance edge to a generated Image node. -->
    <Handle
      id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '50%' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Gem class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Shape Studio</span>
    </div>

    <!-- Last exported thumbnail (no live preview — see note above) -->
    <div class="flex aspect-video items-center justify-center bg-neutral-950">
      <img v-if="thumbUrl" :src="thumbUrl" class="block max-h-full max-w-full object-contain" alt="" />
      <span v-else class="text-[10px] text-white/30">No export yet</span>
    </div>

    <!-- Edit -->
    <div class="border-t border-white/10 p-2 flex items-center gap-1.5">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
    </div>
  </div>
</template>
