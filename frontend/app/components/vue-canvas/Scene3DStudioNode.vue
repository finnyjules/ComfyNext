<script setup lang="ts">
// 3D Studio node card. Unlike the frontend-only studios this is a real backend
// node (Scene3DStudio): the card shows the last baked beauty render straight
// from the persisted `beauty_image` widget (no ephemeral output event needed)
// and "Edit" opens Scene3DStudioSurface, which writes the bakes back into the
// widgets that execute() replays on Run.
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Box, Pencil } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'

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
