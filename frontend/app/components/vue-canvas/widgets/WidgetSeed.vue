<script setup lang="ts">
import { Shuffle, Lock } from 'lucide-vue-next'

// `modelValue` is the seed integer that goes into widgets_values. `isFixed`
// is the lock state — when true, the pre-Run randomizer skips this seed.
// Where that boolean lives depends on the schema: Comfy-standard seeds with
// `control_after_generate` use widgets_values[i+1]; everything else (Replicate
// fleet, third-party custom nodes) stores it in node.properties.seedLocks.
// The parent (ComfyNode.vue) hides that split — we just read/write `isFixed`.
const props = defineProps<{
  modelValue: any
  max?: number
  isFixed?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number]
  'update:isFixed': [value: boolean]
}>()

function toggleMode() {
  emit('update:isFixed', !props.isFixed)
}
</script>
<template>
  <div class="flex items-center gap-1">
    <input
      type="number"
      class="flex-1 bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-foreground text-center tabular-nums outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] [&::-webkit-inner-spin-button]:appearance-none"
      :value="modelValue"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
    <button
      class="shrink-0 size-7 flex items-center justify-center rounded border cursor-pointer transition-[transform,background-color,color,border-color] active:scale-[0.96]"
      :class="props.isFixed
        ? 'bg-amber-500/15 border-amber-400/30 text-amber-200 hover:bg-amber-500/25'
        : 'bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:bg-accent'"
      :title="props.isFixed
        ? 'Fixed — seed stays put on Run. Click to switch back to random.'
        : 'Random — Run picks a new seed each time. Click to lock the current value.'"
      @click="toggleMode"
    >
      <Lock v-if="props.isFixed" class="size-3" />
      <Shuffle v-else class="size-3" />
    </button>
  </div>
</template>
