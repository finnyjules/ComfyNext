<script setup lang="ts">
// Shared styled dropdown for many-option enums.
const model = defineModel<string>({ required: true })
defineProps<{ options: string[] }>()
</script>

<template>
  <select v-model="model"
          class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20">
    <option v-for="o in options" :key="o" :value="o" class="bg-neutral-900 capitalize">{{ o }}</option>
  </select>
</template>
