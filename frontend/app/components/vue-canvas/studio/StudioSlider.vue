<script setup lang="ts">
// Shared slim slider with an optional label + mono value readout. White rail/thumb.
const model = defineModel<number>({ required: true })
defineProps<{ label?: string; min: number; max: number; step?: number }>()
</script>

<template>
  <div>
    <div v-if="label" class="mb-1.5 flex items-center justify-between">
      <span class="text-[11px] text-white/55">{{ label }}</span>
      <span class="font-mono text-[11px] text-white/80">{{ Number(model) }}</span>
    </div>
    <input type="range" v-model.number="model" :min="min" :max="max" :step="step ?? 1" class="studio-range w-full" />
  </div>
</template>
