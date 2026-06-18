<script setup lang="ts">
// Shared segmented control for binary / few-option enums (active = white).
const model = defineModel<string>({ required: true })
defineProps<{ options: string[] }>()
</script>

<template>
  <div class="flex rounded-md bg-white/[0.05] p-0.5">
    <button v-for="o in options" :key="o" type="button" @click="model = o"
            class="flex-1 rounded px-2 py-1 text-[11px] capitalize transition-colors"
            :class="model === o ? 'bg-white text-neutral-900' : 'text-white/55 hover:text-white/80'">
      {{ o }}
    </button>
  </div>
</template>
