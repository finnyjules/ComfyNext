<script setup lang="ts">
defineProps<{ modelValue: any; min?: number; max?: number; step?: number; isFloat?: boolean }>()
defineEmits<{ 'update:modelValue': [value: number] }>()
</script>
<template>
  <input
    type="number"
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 text-center focus:outline-none focus:border-white/20 [&::-webkit-inner-spin-button]:appearance-none"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step ?? (isFloat ? 0.01 : 1)"
    @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
