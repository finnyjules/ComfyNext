<script setup lang="ts">
defineProps<{ options: string[]; modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <select
    class="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-foreground cursor-pointer outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow]"
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="opt in options" :key="opt" :value="opt" class="bg-popover text-popover-foreground">{{ opt }}</option>
  </select>
</template>
