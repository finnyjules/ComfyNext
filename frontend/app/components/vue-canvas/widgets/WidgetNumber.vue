<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: any
  min?: number
  max?: number
  step?: number
  isFloat?: boolean
  name?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

// Semantic end-labels per widget name: [toward-min, toward-max]. Only shown for
// listed widgets (keeps generic numeric widgets uncluttered).
const END_LABELS: Record<string, [string, string]> = {
  lora_scale: ['subtle', 'strong'],
  guidance: ['creative', 'literal'],
  num_inference_steps: ['faster', 'more detail'],
  prompt_strength: ['keep input', 'follow prompt'],
  cfg_scale: ['loose', 'strict'],
  denoise: ['keep input', 'reinvent'],
}

const stepVal = computed(() => props.step ?? (props.isFloat ? 0.01 : 1))

const useSlider = computed(() => {
  const { min, max } = props
  if (min == null || max == null || !isFinite(min) || !isFinite(max)) return false
  const span = max - min
  return span > 0 && span <= 1_000_000
})

const labels = computed<[string, string] | null>(() =>
  props.name && END_LABELS[props.name] ? END_LABELS[props.name] : null)

function clampEmit(raw: number) {
  let v = raw
  if (Number.isNaN(v)) return
  if (props.min != null && v < props.min) v = props.min
  if (props.max != null && v > props.max) v = props.max
  emit('update:modelValue', v)
}
function onSlide(e: Event) { emit('update:modelValue', Number((e.target as HTMLInputElement).value)) }
function onNumber(e: Event) { clampEmit(Number((e.target as HTMLInputElement).value)) }
</script>

<template>
  <div v-if="useSlider" class="w-full">
    <div class="flex items-center gap-1.5">
      <input
        type="range"
        class="cn-slider nodrag nopan nowheel flex-1 min-w-0"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="stepVal"
        @input="onSlide"
      />
      <input
        type="number"
        class="nodrag nopan w-12 shrink-0 bg-white/5 border border-white/10 rounded px-1 h-6 text-[10px] text-foreground text-center tabular-nums outline-none focus-visible:border-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="stepVal"
        @input="onNumber"
      />
    </div>
    <div v-if="labels" class="flex justify-between text-[8px] leading-none text-white/30 mt-0.5 px-0.5">
      <span>{{ labels[0] }}</span>
      <span>{{ labels[1] }}</span>
    </div>
  </div>

  <!-- Fallback: unbounded ranges keep a plain number field -->
  <input
    v-else
    type="number"
    class="nodrag nopan w-full bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-foreground text-center tabular-nums outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] [&::-webkit-inner-spin-button]:appearance-none"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="stepVal"
    @input="onNumber"
  />
</template>

<style scoped>
.cn-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  outline: none;
  cursor: pointer;
}
.cn-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.88);
  border: 2px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: transform 0.1s ease;
}
.cn-slider:active::-webkit-slider-thumb {
  transform: scale(1.15);
}
.cn-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.88);
  border: 2px solid rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
</style>
