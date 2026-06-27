<template>
  <div class="select-none">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" class="w-full rounded-md border border-white/[0.08] bg-white/[0.02]"
         style="touch-action:none" @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp">
      <!-- grid -->
      <line v-for="g in 3" :key="'v'+g" :x1="pad + (g/4)*iw" :y1="pad" :x2="pad + (g/4)*iw" :y2="pad+ih" stroke="rgba(255,255,255,0.06)" />
      <line v-for="g in 3" :key="'h'+g" :x1="pad" :y1="pad + (g/4)*ih" :x2="pad+iw" :y2="pad + (g/4)*ih" stroke="rgba(255,255,255,0.06)" />
      <!-- diagonal (linear reference) -->
      <line :x1="pad" :y1="pad+ih" :x2="pad+iw" :y2="pad" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3 3" />
      <!-- handle leashes -->
      <line :x1="px(0)" :y1="py(0)" :x2="px(p[0])" :y2="py(p[1])" stroke="rgba(255,255,255,0.3)" />
      <line :x1="px(1)" :y1="py(1)" :x2="px(p[2])" :y2="py(p[3])" stroke="rgba(255,255,255,0.3)" />
      <!-- curve -->
      <path :d="curvePath" fill="none" stroke="#fff" stroke-width="2" />
      <!-- endpoints -->
      <circle :cx="px(0)" :cy="py(0)" r="3" fill="rgba(255,255,255,0.4)" />
      <circle :cx="px(1)" :cy="py(1)" r="3" fill="rgba(255,255,255,0.4)" />
      <!-- draggable control points -->
      <circle :cx="px(p[0])" :cy="py(p[1])" r="7" fill="#fff" class="cursor-grab" @pointerdown="grab(0, $event)" />
      <circle :cx="px(p[2])" :cy="py(p[3])" r="7" fill="#fff" class="cursor-grab" @pointerdown="grab(1, $event)" />
    </svg>
    <div class="mt-1 flex items-center justify-between text-[10px] text-white/35">
      <span>ease graph · drag the handles</span>
      <div class="flex gap-1">
        <button v-for="pr in presets" :key="pr.name" type="button" class="rounded bg-white/[0.06] px-1.5 py-0.5 hover:bg-white/15"
                @click="apply(pr.v)">{{ pr.name }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const W = 200, H = 200, pad = 14
const iw = W - pad * 2, ih = H - pad * 2

// Parse "[x1,y1,x2,y2]" → clamped tuple. Defaults to CSS ease-in-out.
const p = computed<[number, number, number, number]>(() => {
  try {
    const a = JSON.parse(props.modelValue) as unknown
    if (Array.isArray(a) && a.length === 4 && a.every((v: unknown) => typeof v === 'number')) {
      const [x1, y1, x2, y2] = a as number[]
      return [clampX(x1!), clampY(y1!), clampX(x2!), clampY(y2!)]
    }
  } catch { /* fall through */ }
  return [0.42, 0, 0.58, 1]
})

const presets = [
  { name: 'ease', v: [0.25, 0.1, 0.25, 1] as const },
  { name: 'in-out', v: [0.42, 0, 0.58, 1] as const },
  { name: 'expo', v: [0.87, 0, 0.13, 1] as const },
  { name: 'linear', v: [0.33, 0.33, 0.66, 0.66] as const },
]

function clampX(v: number) { return Math.max(0, Math.min(1, v)) }
function clampY(v: number) { return Math.max(-0.6, Math.min(1.6, v)) }   // allow gentle overshoot
// graph coords: x→right, y→up (value); SVG y is inverted.
function px(x: number) { return pad + x * iw }
function py(y: number) { return pad + (1 - y) * ih }

const curvePath = computed(() => {
  const [x1, y1, x2, y2] = p.value
  return `M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`
})

const svg = ref<SVGSVGElement | null>(null)
let dragging = -1   // 0 = P1, 1 = P2

function grab(i: number, e: PointerEvent) {
  dragging = i
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}
function onMove(e: PointerEvent) {
  if (dragging < 0 || !svg.value) return
  const r = svg.value.getBoundingClientRect()
  const gx = clampX(((e.clientX - r.left) / r.width * W - pad) / iw)
  const gy = clampY(1 - ((e.clientY - r.top) / r.height * H - pad) / ih)
  const next = [...p.value] as [number, number, number, number]
  next[dragging * 2] = gx
  next[dragging * 2 + 1] = gy
  emit('update:modelValue', JSON.stringify(next.map(n => Math.round(n * 1000) / 1000)))
}
function onUp() { dragging = -1 }
function apply(v: readonly number[]) { emit('update:modelValue', JSON.stringify([...v])) }
</script>
