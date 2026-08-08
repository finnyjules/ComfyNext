<!-- frontend/app/components/vue-canvas/ProfileStopsEditor.vue -->
<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { parseStops, serializeStops, type LoftStop } from '~/lib/spacetype/loftStops'
import StudioColor from './studio/StudioColor.vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const stops = reactive<LoftStop[]>(parseStops(props.modelValue))
const selectedId = reactive({ v: stops[0]?.id ?? '' })

// Re-hydrate if an external change (preset select, var binding) rewrites the JSON.
watch(() => props.modelValue, (json) => {
  const next = parseStops(json)
  if (serializeStops(next) === serializeStops(stops)) return
  stops.splice(0, stops.length, ...next)
  if (!stops.find(s => s.id === selectedId.v)) selectedId.v = stops[0]?.id ?? ''
})

function commit() { emit('update:modelValue', serializeStops(stops)) }

const selected = computed(() => stops.find(s => s.id === selectedId.v) ?? stops[0])

function addStop() {
  const last = stops[stops.length - 1]!
  stops.push({ ...last, id: `s${Date.now().toString(36)}${stops.length}`, x: Math.min(1, last.x + 0.05) })
  selectedId.v = stops[stops.length - 1]!.id
  commit()
}
function removeStop(id: string) {
  if (stops.length <= 2) return
  const i = stops.findIndex(s => s.id === id); if (i < 0) return
  stops.splice(i, 1)
  if (selectedId.v === id) selectedId.v = stops[0]!.id
  commit()
}
function set<K extends keyof LoftStop>(k: K, v: LoftStop[K]) {
  const s = selected.value; if (!s) return
  ;(s[k] as LoftStop[K]) = v
  commit()
}

// Canvas drag: map click/drag to the selected stop's x,y (0..1).
const W = 220, H = 120
function nodeStyle(s: LoftStop) { return { left: `${s.x * W}px`, top: `${s.y * H}px` } }
function onCanvasPointer(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  const s = selected.value; if (!s) return
  s.x = x; s.y = y; commit()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- spine canvas: draggable XY nodes -->
    <div class="relative rounded border border-white/10 bg-black/30"
         :style="{ width: W + 'px', height: H + 'px' }"
         @pointerdown="(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onCanvasPointer(e) }"
         @pointermove="(e) => { if (e.buttons) onCanvasPointer(e) }">
      <button v-for="s in stops" :key="s.id" type="button"
              class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              :class="s.id === selectedId.v ? 'border-white bg-blue-500' : 'border-white/40 bg-white/20'"
              :style="nodeStyle(s)"
              @pointerdown.stop="selectedId.v = s.id" />
    </div>

    <div class="flex items-center gap-1">
      <button type="button" class="rounded bg-white/10 px-2 py-1 text-[10px]" @click="addStop">+ stop</button>
      <button type="button" class="rounded bg-white/10 px-2 py-1 text-[10px]"
              :disabled="stops.length <= 2" @click="removeStop(selectedId.v)">– stop</button>
      <span class="ml-auto text-[10px] text-white/40">{{ stops.length }} stops</span>
    </div>

    <!-- selected-stop inspector -->
    <div v-if="selected" class="flex flex-col gap-1 rounded border border-white/10 p-2">
      <label class="flex items-center justify-between text-[10px] text-white/50">Depth
        <input type="range" min="-1" max="1" step="0.01" :value="selected.z"
               @input="(e) => set('z', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Width
        <input type="range" min="0.05" max="6" step="0.05" :value="selected.width"
               @input="(e) => set('width', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Height
        <input type="range" min="0.05" max="6" step="0.05" :value="selected.height"
               @input="(e) => set('height', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Roll
        <input type="range" min="-180" max="180" step="1" :value="selected.roll"
               @input="(e) => set('roll', Number((e.target as HTMLInputElement).value))" /></label>
      <StudioColor :model-value="selected.color" @update:model-value="(v: string) => set('color', v)" />
    </div>
  </div>
</template>
