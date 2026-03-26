<script setup lang="ts">
defineProps<{ options: string[]; modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <select
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 cursor-pointer focus:outline-none focus:border-white/20"
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>
