<script setup lang="ts">
// Shared aside layer list for the studios. Pure presentation: renders an ordered
// list of layers (top = front), and emits intents. Reorder is via native HTML5
// drag on the row handle. Holds no studio-specific logic.
import { ref } from 'vue'
import { Plus, X, Copy, GripVertical, Eye, EyeOff } from 'lucide-vue-next'

defineProps<{
  layers: { label: string; enabled: boolean; thumb?: string }[]
  activeIndex: number
  max: number
}>()
const emit = defineEmits<{
  select: [i: number]; reorder: [from: number, to: number]
  add: []; remove: [i: number]; duplicate: [i: number]; toggle: [i: number]
}>()

const dragFrom = ref<number | null>(null)
function onDrop(to: number) {
  if (dragFrom.value !== null && dragFrom.value !== to) emit('reorder', dragFrom.value, to)
  dragFrom.value = null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-xs font-medium text-white/70">Layers</span>
      <button v-if="layers.length < max" aria-label="Add layer"
              class="rounded bg-white/[0.06] p-1 text-white/60 hover:text-white" @click="emit('add')">
        <Plus class="h-3.5 w-3.5" />
      </button>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <!-- Rendered front-to-back: index 0 (base) sits at the BOTTOM of the list. -->
      <div v-for="i in layers.map((_, k) => layers.length - 1 - k)" :key="i"
           draggable="true"
           @dragstart="dragFrom = i" @dragover.prevent @drop="onDrop(i)"
           @click="emit('select', i)"
           class="group flex cursor-grab items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition"
           :class="activeIndex === i ? 'border-white/25 bg-white/[0.10] text-white'
                                     : 'border-transparent bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'">
        <GripVertical class="h-3.5 w-3.5 shrink-0 text-white/25" />
        <img v-if="layers[i]!.thumb" :src="layers[i]!.thumb" class="h-6 w-6 shrink-0 rounded object-cover" />
        <span class="min-w-0 flex-1 truncate">{{ layers[i]!.label }}</span>
        <button aria-label="Toggle layer" class="shrink-0 text-white/30 hover:text-white/80"
                @click.stop="emit('toggle', i)">
          <Eye v-if="layers[i]!.enabled" class="h-3.5 w-3.5" />
          <EyeOff v-else class="h-3.5 w-3.5" />
        </button>
        <button aria-label="Duplicate layer" class="shrink-0 text-white/0 group-hover:text-white/40 hover:!text-white/80"
                @click.stop="emit('duplicate', i)">
          <Copy class="h-3 w-3" />
        </button>
        <button v-if="layers.length > 1" aria-label="Remove layer"
                class="shrink-0 text-white/0 group-hover:text-white/40 hover:!text-white/80"
                @click.stop="emit('remove', i)">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
