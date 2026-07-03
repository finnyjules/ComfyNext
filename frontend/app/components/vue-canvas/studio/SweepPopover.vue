<script setup lang="ts">
// Sweep popover — lets the user generate N evenly-spaced values for a slider
// control (or N literal values for any other control kind) and turn them into
// sweep rows on the wired collection in one shot. Mirrors CanvasContextMenu's
// teleport + viewport-clamp + Escape/backdrop-close conventions, but is its
// own small floating panel rather than a menu.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'

const props = defineProps<{
  control: StudioControlDesc
  anchor: { x: number; y: number }
}>()
const emit = defineEmits<{ (e: 'apply', values: (string | number)[]): void; (e: 'close'): void }>()

const isSlider = computed(() => props.control.kind === 'slider')

// ── slider (number) mode ────────────────────────────────────────────────────
const min = ref(props.control.min ?? 0)
const max = ref(props.control.max ?? 100)
const steps = ref(5)

function clampSteps(n: number): number {
  if (!Number.isFinite(n)) return 5
  return Math.min(24, Math.max(2, Math.round(n)))
}

const previewValues = computed<number[]>(() => {
  const n = clampSteps(steps.value)
  const lo = Number(min.value), hi = Number(max.value)
  const stepSize = props.control.step ?? 1
  const round = (v: number) => (stepSize > 0 ? Math.round(v / stepSize) * stepSize : v)
  if (n <= 1) return [round(lo)]
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    out.push(round(lo + (hi - lo) * t))
  }
  return out
})

// ── textarea (color/select/text/other) mode ─────────────────────────────────
const textValue = ref(props.control.kind === 'select' ? (props.control.options ?? []).join('\n') : '')
const textareaPlaceholder = computed(() => (props.control.kind === 'color' ? '#0C447C' : 'One value per line'))

function applySweep() {
  if (isSlider.value) {
    emit('apply', previewValues.value)
  } else {
    const lines = textValue.value.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (!lines.length) return
    emit('apply', lines)
  }
  emit('close')
}

// ── positioning (viewport-clamped, like CanvasContextMenu) ──────────────────
const rootRef = ref<HTMLDivElement | null>(null)
const adjustedPos = ref({ x: props.anchor.x, y: props.anchor.y })
onMounted(() => {
  nextTick(() => {
    const el = rootRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = props.anchor.x
    let ny = props.anchor.y
    if (nx + rect.width + 8 > vw) nx = Math.max(8, vw - rect.width - 8)
    if (ny + rect.height + 8 > vh) ny = Math.max(8, vh - rect.height - 8)
    adjustedPos.value = { x: nx, y: ny }
  })
})

function onBackdropClick(e: MouseEvent) {
  const target = e.target as Node
  if (rootRef.value?.contains(target)) return
  emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('mousedown', onBackdropClick, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('mousedown', onBackdropClick, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="fixed z-[210] w-64 rounded-lg border border-white/10 bg-[#141414] p-3 text-[12px] text-white/90 shadow-2xl"
      :style="{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }"
    >
      <div class="mb-2 font-medium text-white/90">Sweep {{ control.label.toLowerCase() }}</div>

      <template v-if="isSlider">
        <div class="mb-2 grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-[11px] text-white/50">Min</span>
            <input v-model.number="min" type="number" class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] outline-none focus:border-white/25" />
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] text-white/50">Max</span>
            <input v-model.number="max" type="number" class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] outline-none focus:border-white/25" />
          </label>
        </div>
        <label class="mb-2 block">
          <span class="mb-1 block text-[11px] text-white/50">Steps</span>
          <input
            :value="steps"
            type="number"
            min="2"
            max="24"
            class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[12px] outline-none focus:border-white/25"
            @input="steps = clampSteps(Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <div class="mb-3 text-[11px] text-white/40 break-words">
          {{ previewValues.join(', ') }}
        </div>
      </template>

      <template v-else>
        <label class="mb-3 block">
          <span class="mb-1 block text-[11px] text-white/50">Values</span>
          <textarea
            v-model="textValue"
            rows="5"
            :placeholder="textareaPlaceholder"
            class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] outline-none focus:border-white/25"
          />
        </label>
      </template>

      <div class="flex justify-end gap-2">
        <button class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10" @click="emit('close')">
          Cancel
        </button>
        <button class="rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90 hover:bg-white/25" @click="applySweep">
          Apply
        </button>
      </div>
    </div>
  </Teleport>
</template>
