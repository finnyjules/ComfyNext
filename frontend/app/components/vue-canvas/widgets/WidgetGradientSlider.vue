<script setup lang="ts">
const props = defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
  isFloat?: boolean
  gradient: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const trackRef = ref<HTMLDivElement | null>(null)

const percent = computed(() => {
  const range = props.max - props.min
  if (!range) return 50
  const v = Math.max(props.min, Math.min(props.max, Number(props.modelValue ?? 0)))
  return ((v - props.min) / range) * 100
})

const displayValue = computed(() => {
  const v = Number(props.modelValue ?? 0)
  if (props.isFloat) {
    // Strip trailing zeros for a tidy number column
    return Number.isFinite(v) ? +v.toFixed(2) : 0
  }
  return Math.round(v)
})

function snap(value: number): number {
  const step = props.step || (props.isFloat ? 0.01 : 1)
  const snapped = Math.round((value - props.min) / step) * step + props.min
  return Math.max(props.min, Math.min(props.max, snapped))
}

function setFromX(clientX: number) {
  const el = trackRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  emit('update:modelValue', snap(props.min + p * (props.max - props.min)))
}

const dragging = ref(false)
function onPointerDown(e: PointerEvent) {
  // Prevent VueFlow node-drag / canvas-pan from claiming this gesture.
  e.stopPropagation()
  dragging.value = true
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
  setFromX(e.clientX)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  e.stopPropagation()
  setFromX(e.clientX)
}
function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  } catch {}
}

function onInputChange(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const v = props.isFloat ? parseFloat(raw) : parseInt(raw, 10)
  if (!Number.isFinite(v)) return
  emit('update:modelValue', Math.max(props.min, Math.min(props.max, v)))
}
</script>

<template>
  <div class="flex flex-col gap-1 nopan nodrag select-none">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] text-white/70">{{ label }}:</span>
      <input
        type="number"
        :value="displayValue"
        :min="min"
        :max="max"
        :step="step || (isFloat ? 0.01 : 1)"
        class="w-14 h-5 text-[10px] text-center bg-[#1a1a1a] border border-[#2a2a2a] rounded text-white/90 focus:outline-none focus:border-white/30"
        @change="onInputChange"
      />
    </div>
    <div
      ref="trackRef"
      class="relative pb-2 nopan nodrag cursor-ew-resize touch-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div
        class="h-2 rounded-[2px] pointer-events-none"
        :style="{ background: gradient }"
      />
      <div
        class="absolute top-[7px] -translate-x-1/2 pointer-events-none transition-[left] duration-75 ease-out"
        :style="{ left: `${percent}%` }"
      >
        <div class="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[7px] border-l-transparent border-r-transparent border-b-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />
      </div>
    </div>
  </div>
</template>
