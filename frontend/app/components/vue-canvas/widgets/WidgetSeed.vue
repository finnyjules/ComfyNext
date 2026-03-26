<script setup lang="ts">
import { Shuffle } from 'lucide-vue-next'
const props = defineProps<{ modelValue: any }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
function randomize() {
  emit('update:modelValue', Math.floor(Math.random() * 2 ** 53))
}
</script>
<template>
  <div class="flex items-center gap-1">
    <input
      type="number"
      class="flex-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 text-center focus:outline-none focus:border-white/20 [&::-webkit-inner-spin-button]:appearance-none"
      :value="modelValue"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
    <button
      class="shrink-0 p-1 rounded bg-[#2a2a2a] border border-[#3a3a3a] text-white/60 hover:text-white/90 cursor-pointer transition-colors"
      title="Randomize"
      @click="randomize"
    >
      <Shuffle class="size-3" />
    </button>
  </div>
</template>
