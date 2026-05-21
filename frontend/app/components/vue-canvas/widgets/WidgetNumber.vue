<script setup lang="ts">
defineProps<{ modelValue: any; min?: number; max?: number; step?: number; isFloat?: boolean }>()
defineEmits<{ 'update:modelValue': [value: number] }>()
</script>
<template>
  <input
    type="number"
    class="w-full bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-foreground text-center outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] [&::-webkit-inner-spin-button]:appearance-none"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step ?? (isFloat ? 0.01 : 1)"
    @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
