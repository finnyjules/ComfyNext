<script setup lang="ts">
// Multi-stop gradient ramp editor for the 3D Studio's gradient material.
// v-model on GradientStop[]. The bar is painted with a CSS linear-gradient built
// from the very same stops the shader's LUT is built from, so the editor preview
// and the rendered object cannot disagree.
//
// Pointer rules (hard-won in this codebase): every pointer entry point is
// @pointerdown.stop so a drag can never leak through to OrbitControls, and drags
// use setPointerCapture so leaving the bar keeps tracking. Capture is released on
// pointerup/pointercancel.
import { computed, ref } from 'vue'
import { GRADIENT_STOPS_MIN, GRADIENT_STOPS_MAX, type GradientStop } from '~/lib/scene3d/config'
import { hexToRgb, rgbToHex } from './color'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'

const model = defineModel<GradientStop[]>({ required: true })

const selectedIdx = ref(0)
const bar = ref<HTMLElement | null>(null)
// While dragging we track the pointer visually without re-sorting on every move
// (sorting mid-drag would make a handle jump under the cursor). Sorting happens
// on drop; `dragIdx` is the index in the *unsorted* working array.
const dragIdx = ref<number | null>(null)

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const sorted = computed(() => [...model.value].sort((a, b) => a.pos - b.pos))

const canDelete = computed(() => model.value.length > GRADIENT_STOPS_MIN)
const canInsert = computed(() => model.value.length < GRADIENT_STOPS_MAX)

const barStyle = computed(() => {
  const s = sorted.value
  const parts = s.length
    ? s.map((st) => `${st.color} ${(clamp01(st.pos) * 100).toFixed(2)}%`)
    : ['#000 0%', '#fff 100%']
  return { background: `linear-gradient(to right, ${parts.join(', ')})` }
})

const selectedStop = computed<GradientStop | null>(() => model.value[selectedIdx.value] ?? null)
const selectedColor = computed<string>({
  get: () => selectedStop.value?.color ?? '#ffffff',
  set: (v) => patch(selectedIdx.value, { color: v }),
})
const selectedPos = computed<number>({
  get: () => Math.round((selectedStop.value?.pos ?? 0) * 100) / 100,
  set: (v) => patch(selectedIdx.value, { pos: clamp01(Number(v) || 0) }),
})

/** Colour of the current ramp at `pos`, interpolated in sRGB — the same space the
 *  LUT interpolates in, so a stop inserted with this colour is a visual no-op. */
function sampleAt(pos: number): string {
  const s = sorted.value
  if (!s.length) return '#ffffff'
  if (pos <= s[0]!.pos) return s[0]!.color
  if (pos >= s[s.length - 1]!.pos) return s[s.length - 1]!.color
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!, b = s[i + 1]!
    if (pos >= a.pos && pos <= b.pos) {
      const span = b.pos - a.pos
      const f = span <= 1e-6 ? 0 : (pos - a.pos) / span
      const ca = hexToRgb(a.color), cb = hexToRgb(b.color)
      return rgbToHex(
        Math.round(ca[0] + (cb[0] - ca[0]) * f),
        Math.round(ca[1] + (cb[1] - ca[1]) * f),
        Math.round(ca[2] + (cb[2] - ca[2]) * f),
      )
    }
  }
  return s[s.length - 1]!.color
}

// Never mutate the prop array in place — every write emits a fresh array.
function commit(next: GradientStop[]) { model.value = next }
function patch(idx: number, fields: Partial<GradientStop>) {
  const next = model.value.map((st, i) => (i === idx ? { ...st, ...fields } : { ...st }))
  if (!next[idx]) return
  commit(next)
}

function posFromEvent(e: PointerEvent | MouseEvent): number {
  const r = bar.value?.getBoundingClientRect()
  if (!r || r.width <= 0) return 0
  return clamp01((e.clientX - r.left) / r.width)
}

/** Re-sort and keep the selection pointing at the same stop object. */
function sortAndKeepSelection() {
  const cur = model.value[selectedIdx.value]
  const next = model.value.map((s) => ({ ...s })).sort((a, b) => a.pos - b.pos)
  commit(next)
  if (cur) {
    const i = next.findIndex((s) => s.pos === cur.pos && s.color === cur.color)
    selectedIdx.value = i >= 0 ? i : 0
  }
}

function onBarDown(e: PointerEvent) {
  // Handles stop their own pointerdown, so reaching here means empty bar.
  if (!canInsert.value) return
  const pos = posFromEvent(e)
  const next = [...model.value.map((s) => ({ ...s })), { pos, color: sampleAt(pos) }]
    .sort((a, b) => a.pos - b.pos)
  commit(next)
  selectedIdx.value = next.findIndex((s) => s.pos === pos)
}

function onHandleDown(e: PointerEvent, idx: number) {
  selectedIdx.value = idx
  dragIdx.value = idx
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    if (dragIdx.value === null) return
    patch(dragIdx.value, { pos: posFromEvent(ev) })
  }
  const end = () => {
    el.releasePointerCapture?.(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    dragIdx.value = null
    sortAndKeepSelection()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

function onHandleDoubleClick(idx: number) {
  if (!canDelete.value) return
  const next = model.value.filter((_, i) => i !== idx).map((s) => ({ ...s }))
  commit(next)
  selectedIdx.value = Math.min(idx, next.length - 1)
}
</script>

<template>
  <div class="space-y-2" @pointerdown.stop>
    <!-- Ramp bar. Handles sit on the bar; clicking bare bar inserts a stop. -->
    <div class="pb-2.5">
      <div
        ref="bar"
        class="relative h-6 w-full cursor-copy rounded-md border border-white/[0.12]"
        :style="barStyle"
        @pointerdown.stop="onBarDown"
      >
        <button
          v-for="(stop, i) in model"
          :key="i"
          type="button"
          class="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border shadow-sm shadow-black/50 transition-[border-color]"
          :class="i === selectedIdx ? 'border-white ring-1 ring-black/40' : 'border-white/60 hover:border-white/90'"
          :style="{ left: `${Math.min(1, Math.max(0, stop.pos)) * 100}%`, background: stop.color }"
          :title="`Stop ${i + 1} — drag to move, double-click to delete`"
          :aria-label="`Gradient stop ${i + 1}`"
          @pointerdown.stop.prevent="(e: PointerEvent) => onHandleDown(e, i)"
          @dblclick.stop.prevent="onHandleDoubleClick(i)"
        ></button>
      </div>
    </div>

    <!-- Selected stop: colour + position -->
    <div class="flex items-center gap-2">
      <span class="text-[11px] text-white/55">Stop</span>
      <StudioColor v-if="selectedStop" v-model="selectedColor" />
      <input
        v-model.number="selectedPos"
        type="number" min="0" max="1" step="0.01"
        class="ml-auto w-16 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 text-center font-mono text-[11px] text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        aria-label="Stop position"
      />
      <span class="w-10 text-right font-mono text-[10px] text-white/30">{{ model.length }}/{{ GRADIENT_STOPS_MAX }}</span>
    </div>
    <p class="text-[10px] leading-snug text-white/30">
      Click the bar to add a stop, drag to move, double-click to delete.
    </p>
  </div>
</template>
