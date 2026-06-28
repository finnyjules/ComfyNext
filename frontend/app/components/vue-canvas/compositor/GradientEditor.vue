<script setup lang="ts">
/**
 * GradientEditor — authors a compositor `Gradient` (linear or radial, with any
 * number of stops). Used inside FillControl when the fill type is "gradient".
 * A live bar shows the gradient; stop handles on the bar drag to reposition,
 * and a row per stop edits colour / removes it. Emits the native multi-stop
 * Gradient so it drops straight into resolvePaint (no 2-stop collapse).
 */
import { ref, computed } from 'vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import type { Gradient, GradientStop } from '~/composables/useCompositorLayers'

const props = defineProps<{ modelValue: Gradient }>()
const emit = defineEmits<{ 'update:modelValue': [Gradient] }>()

const barRef = ref<HTMLElement | null>(null)

const isRadial = computed(() => props.modelValue.type === 'radial')
const angle = computed(() => (props.modelValue.type === 'linear' ? props.modelValue.angle : 45))
const stops = computed(() => props.modelValue.stops)

/** Emit a gradient built from the current value plus a patch. */
function emitWith(patch: { type?: 'linear' | 'radial'; angle?: number; stops?: GradientStop[] }): void {
  const type = patch.type ?? props.modelValue.type
  const nextStops = patch.stops ?? props.modelValue.stops
  if (type === 'radial') emit('update:modelValue', { type: 'radial', stops: nextStops })
  else emit('update:modelValue', { type: 'linear', angle: patch.angle ?? angle.value, stops: nextStops })
}

function setMode(m: 'linear' | 'radial') { emitWith({ type: m }) }
function setAngle(a: number) { emitWith({ type: 'linear', angle: a }) }
function setStopColor(i: number, color: string) {
  emitWith({ stops: props.modelValue.stops.map((s, j) => (j === i ? { ...s, color } : s)) })
}
function setStopOffset(i: number, offset: number) {
  const o = Math.max(0, Math.min(1, offset))
  emitWith({ stops: props.modelValue.stops.map((s, j) => (j === i ? { ...s, offset: o } : s)) })
}
function addStop() {
  const sorted = [...props.modelValue.stops].sort((a, b) => a.offset - b.offset)
  // Insert at the midpoint of the widest gap, colour-blended toward its left edge.
  let bestGap = -1, at = 0.5, color = sorted[0]?.color ?? '#ffffff'
  for (let k = 0; k < sorted.length - 1; k++) {
    const lo = sorted[k]!, hi = sorted[k + 1]!
    const g = hi.offset - lo.offset
    if (g > bestGap) { bestGap = g; at = (lo.offset + hi.offset) / 2; color = lo.color }
  }
  emitWith({ stops: [...props.modelValue.stops, { offset: at, color }] })
}
function removeStop(i: number) {
  if (props.modelValue.stops.length <= 2) return
  emitWith({ stops: props.modelValue.stops.filter((_, j) => j !== i) })
}

const cssGradient = computed(() => {
  const ss = [...stops.value].sort((a, b) => a.offset - b.offset)
    .map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')
  return isRadial.value ? `radial-gradient(circle at center, ${ss})` : `linear-gradient(90deg, ${ss})`
})

function onHandleDown(i: number, e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const bar = barRef.value; if (!bar) return
  const move = (ev: PointerEvent) => {
    const r = bar.getBoundingClientRect()
    setStopOffset(i, r.width ? (ev.clientX - r.left) / r.width : 0)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="space-y-2">
    <!-- linear / radial -->
    <div class="flex items-center gap-1">
      <button type="button" class="flex-1 h-6 rounded text-[11px] cursor-pointer transition-colors"
        :class="!isRadial ? 'bg-white text-neutral-900 font-medium' : 'bg-white/[0.06] text-white/65 hover:bg-white/10'"
        @click="setMode('linear')">Linear</button>
      <button type="button" class="flex-1 h-6 rounded text-[11px] cursor-pointer transition-colors"
        :class="isRadial ? 'bg-white text-neutral-900 font-medium' : 'bg-white/[0.06] text-white/65 hover:bg-white/10'"
        @click="setMode('radial')">Radial</button>
    </div>

    <!-- preview bar + draggable stop handles -->
    <div ref="barRef" class="relative h-6 rounded border border-white/10 overflow-visible"
      :style="{ background: cssGradient }">
      <div v-for="(s, i) in stops" :key="'h' + i"
        class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-3 rounded-full border-2 border-white shadow cursor-ew-resize"
        :style="{ left: (s.offset * 100) + '%', background: s.color }"
        @pointerdown="onHandleDown(i, $event)" />
    </div>

    <!-- angle (linear only) -->
    <div v-if="!isRadial">
      <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
        <span>Angle</span><span class="tabular-nums normal-case">{{ Math.round(angle) }}°</span>
      </div>
      <input type="range" min="0" max="360" step="5" :value="angle" class="w-full accent-white cursor-pointer"
        @input="setAngle(Number(($event.target as HTMLInputElement).value))" />
    </div>

    <!-- per-stop rows -->
    <div class="space-y-1.5">
      <div v-for="(s, i) in stops" :key="'r' + i" class="flex items-center gap-1.5">
        <StudioColor :model-value="s.color" @update:model-value="(v: string) => setStopColor(i, v)" />
        <input type="number" min="0" max="100" step="1" :value="Math.round(s.offset * 100)"
          class="w-12 bg-white/10 rounded px-1.5 py-1 text-[11px] text-white/85 tabular-nums outline-none"
          @input="setStopOffset(i, Number(($event.target as HTMLInputElement).value) / 100)" />
        <span class="text-[9px] text-white/30">%</span>
        <button type="button" class="ml-auto h-5 w-5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
          :disabled="stops.length <= 2" title="Remove stop" @click="removeStop(i)">✕</button>
      </div>
    </div>

    <button type="button" class="w-full h-6 rounded border border-dashed border-white/15 text-[11px] text-white/55 hover:text-white/85 hover:border-white/30 cursor-pointer"
      @click="addStop">+ Add stop</button>
  </div>
</template>
