<script setup lang="ts">
defineProps<{ modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
<template>
  <button
    data-slot="toggle"
    class="relative w-8 h-4 rounded-full transition-colors cursor-pointer"
    :class="modelValue ? 'bg-emerald-500' : 'bg-input'"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <div
      class="absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform"
      :class="modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"
    />
  </button>
</template>
