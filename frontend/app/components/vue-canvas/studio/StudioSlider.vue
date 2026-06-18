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

<style scoped>
.studio-range { -webkit-appearance: none; appearance: none; height: 2px; border-radius: 2px; background: rgba(255, 255, 255, 0.12); }
.studio-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 9999px; background: #fff; cursor: pointer; }
.studio-range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 9999px; background: #fff; cursor: pointer; }
.studio-range:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.12); }
</style>
