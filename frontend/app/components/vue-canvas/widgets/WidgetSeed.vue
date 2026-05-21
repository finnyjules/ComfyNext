<script setup lang="ts">
import { Shuffle } from 'lucide-vue-next'
const props = defineProps<{ modelValue: any; max?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
function randomize() {
  const limit = props.max ?? 2 ** 53
  emit('update:modelValue', Math.floor(Math.random() * limit))
}
</script>
<template>
  <div class="flex items-center gap-1">
    <input
      type="number"
      class="flex-1 bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-foreground text-center outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] [&::-webkit-inner-spin-button]:appearance-none"
      :value="modelValue"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
    <button
      class="shrink-0 size-7 flex items-center justify-center rounded bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
      title="Randomize"
      @click="randomize"
    >
      <Shuffle class="size-3" />
    </button>
  </div>
</template>
