<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Sparkles } from 'lucide-vue-next'

// Space Type — a frontend-only config node for the client-side Three.js ribbon
// typography editor. No inputs/outputs (no backend class_type), so it never
// enters an executed prompt. The card shows the configured text + an optional
// preview thumbnail; "Edit" reopens the SpaceTypeSurface modal bound to this node.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    properties?: Record<string, any>
  }
}>()

const cfg = computed(() => props.data.properties?.comfynext_spaceType)
const text = computed(() => cfg.value?.params?.text ?? 'SPACE TYPE')
const thumb = computed<string | null>(() => cfg.value?.thumb ?? null)

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openSpaceType', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Sparkles class="h-3.5 w-3.5 text-emerald-400" />
      <span class="text-xs font-medium text-white/80">Space Type</span>
      <button
        class="ml-auto flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
    </div>

    <!-- Preview -->
    <div class="relative flex h-[88px] items-center justify-center bg-neutral-950">
      <img v-if="thumb" :src="thumb" class="h-full w-full object-contain" alt="Space Type preview" />
      <div v-else class="px-3 text-center">
        <div class="truncate text-sm font-semibold uppercase tracking-wide text-white/90">{{ text }}</div>
        <div class="mt-0.5 text-[10px] text-white/40">no preview yet</div>
      </div>
    </div>
  </div>
</template>
