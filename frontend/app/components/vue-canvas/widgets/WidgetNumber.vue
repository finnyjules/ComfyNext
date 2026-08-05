<script setup lang="ts">
import { computed } from 'vue'
import { endLabelsFor, isSliderRange } from '~/lib/canvas/widgetEndLabels'

const props = defineProps<{
  modelValue: any
  min?: number
  max?: number
  step?: number
  isFloat?: boolean
  name?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

// The end-label map and the bounded-range test both live in ~/lib/canvas/widgetEndLabels
// because ComfyNodeWidget needs the same two answers when it routes a bounded number to a
// StudioRow instead of here — one copy, so the two paths cannot disagree about which
// widgets get labels or which ranges are slider-shaped.
const stepVal = computed(() => props.step ?? (props.isFloat ? 0.01 : 1))
const useSlider = computed(() => isSliderRange(props.min, props.max))
const labels = computed<[string, string] | null>(() => endLabelsFor(props.name))

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
/* Slider visual is unified globally in main.css (input[type=range], the studio look);
   width comes from `flex-1 min-w-0` in the template. */
</style>
