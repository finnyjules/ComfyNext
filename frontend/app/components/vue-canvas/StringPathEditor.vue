<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import {
  parsePath, serializePath, defaultPath, forwardHandle, backHandle,
  type StringPathDoc, type PathPoint,
} from '~/lib/spacetype/stringPath'

/**
 * Interactive bézier-path editor for the String effect (STG /string). An SVG
 * overlay tracking the preview canvas's on-screen rectangle. Click-drag on empty
 * space to drop a point (the drag sets its handle); drag points/handle squares to
 * adjust; Enter starts a new string; Delete removes the selected point; Reset
 * restores the seed. Emits the serialized StringPathDoc back into the param.
 */

const props = defineProps<{ modelValue: string; canvas: HTMLCanvasElement | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const rootEl = ref<HTMLDivElement | null>(null)
const doc = ref<StringPathDoc>(parsePath(props.modelValue))
// The string new points are appended to (last by default; Enter adds a fresh one).
const activeIdx = ref(Math.max(0, doc.value.strings.length - 1))
const selected = ref<{ s: number; p: number } | null>(null)

// On-screen box of the canvas, relative to this overlay's root (= the wrapper).
const box = reactive({ left: 0, top: 0, width: 1, height: 1 })

let lastEmitted = props.modelValue
watch(() => props.modelValue, (v) => {
  if (v === lastEmitted) return // ignore our own echo
  doc.value = parsePath(v)
  activeIdx.value = Math.max(0, doc.value.strings.length - 1)
})

function emitDoc() {
  lastEmitted = serializePath(doc.value)
  emit('update:modelValue', lastEmitted)
}

function updateBox() {
  const c = props.canvas, r = rootEl.value
  if (!c || !r) return
  const cr = c.getBoundingClientRect()
  const rr = r.getBoundingClientRect()
  box.left = cr.left - rr.left
  box.top = cr.top - rr.top
  box.width = Math.max(1, cr.width)
  box.height = Math.max(1, cr.height)
}

let ro: ResizeObserver | null = null
let rafId = 0
onMounted(() => {
  updateBox()
  // Track size/position changes (canvas resizes with output dims / modal layout).
  ro = new ResizeObserver(updateBox)
  if (props.canvas) ro.observe(props.canvas)
  if (rootEl.value) ro.observe(rootEl.value)
  window.addEventListener('resize', updateBox)
  // A light rAF keeps the box synced through layout shifts ResizeObserver misses.
  const tick = () => { updateBox(); rafId = requestAnimationFrame(tick) }
  rafId = requestAnimationFrame(tick)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', updateBox)
  window.removeEventListener('keydown', onKey)
  if (rafId) cancelAnimationFrame(rafId)
})

// ---- coordinate helpers (normalized [0,1] ↔ overlay px) ----
function toNorm(e: PointerEvent): { x: number; y: number } {
  const x = (e.clientX - (props.canvas?.getBoundingClientRect().left ?? 0)) / box.width
  const y = (e.clientY - (props.canvas?.getBoundingClientRect().top ?? 0)) / box.height
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}
const px = (nx: number) => box.left + nx * box.width
const py = (ny: number) => box.top + ny * box.height

// Hit threshold in normalized units (~10 px on each axis).
const hitX = () => 10 / box.width
const hitY = () => 10 / box.height
function near(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= hitX() && Math.abs(ay - by) <= hitY()
}

// ---- interaction state ----
type Drag =
  | { kind: 'point'; s: number; p: number; ox: number; oy: number }
  | { kind: 'fwd'; s: number; p: number }
  | { kind: 'back'; s: number; p: number }
  | { kind: 'new'; s: number; p: number; dragged: boolean }
let drag: Drag | null = null

function hitTest(np: { x: number; y: number }): Drag | null {
  // Handles first (they sit on top of points), then points, across all strings.
  for (let s = 0; s < doc.value.strings.length; s++) {
    const pts = doc.value.strings[s]!.points
    for (let p = 0; p < pts.length; p++) {
      const f = forwardHandle(pts[p]!); const b = backHandle(pts[p]!)
      if (near(np.x, np.y, f.x, f.y)) return { kind: 'fwd', s, p }
      if (near(np.x, np.y, b.x, b.y)) return { kind: 'back', s, p }
    }
  }
  for (let s = 0; s < doc.value.strings.length; s++) {
    const pts = doc.value.strings[s]!.points
    for (let p = 0; p < pts.length; p++) {
      if (near(np.x, np.y, pts[p]!.x, pts[p]!.y)) return { kind: 'point', s, p, ox: pts[p]!.x - np.x, oy: pts[p]!.y - np.y }
    }
  }
  return null
}

function onPointerDown(e: PointerEvent) {
  updateBox()
  const np = toNorm(e)
  const hit = hitTest(np)
  if (hit) {
    drag = hit
    if (hit.kind === 'point' || hit.kind === 'fwd' || hit.kind === 'back') selected.value = { s: hit.s, p: hit.p }
  } else {
    // Empty space → tentative new point; the drag (if any) sets its handle.
    if (!doc.value.strings[activeIdx.value]) doc.value.strings[activeIdx.value] = { points: [] }
    const pts = doc.value.strings[activeIdx.value]!.points
    const pt: PathPoint = { x: np.x, y: np.y, a: Math.PI, hl: 0.12, althl: 0.12 }
    pts.push(pt)
    drag = { kind: 'new', s: activeIdx.value, p: pts.length - 1, dragged: false }
    selected.value = { s: activeIdx.value, p: pts.length - 1 }
  }
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const np = toNorm(e)
  const pts = doc.value.strings[drag.s]?.points
  if (!pts) return
  const pt = pts[drag.p]
  if (!pt) return
  if (drag.kind === 'point') {
    pt.x = Math.min(1, Math.max(0, np.x + drag.ox))
    pt.y = Math.min(1, Math.max(0, np.y + drag.oy))
  } else if (drag.kind === 'fwd') {
    pt.a = Math.atan2(np.y - pt.y, np.x - pt.x)
    pt.hl = Math.hypot(np.x - pt.x, np.y - pt.y)
  } else if (drag.kind === 'back') {
    // Back handle points in the −a direction → a aims opposite the drag target.
    pt.a = Math.atan2(np.y - pt.y, np.x - pt.x) + Math.PI
    pt.althl = Math.hypot(np.x - pt.x, np.y - pt.y)
  } else if (drag.kind === 'new') {
    const d = Math.hypot(np.x - pt.x, np.y - pt.y)
    if (d > 0.005) {
      drag.dragged = true
      pt.a = Math.atan2(np.y - pt.y, np.x - pt.x)
      pt.hl = d; pt.althl = d
    }
  }
}

function onPointerUp(e: PointerEvent) {
  if (drag) { emitDoc(); drag = null }
  ;(e.target as Element).releasePointerCapture?.(e.pointerId)
}

function onKey(e: KeyboardEvent) {
  // Ignore when typing in an input elsewhere in the editor panel.
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Enter') {
    doc.value.strings.push({ points: [] })
    activeIdx.value = doc.value.strings.length - 1
    selected.value = null
    e.preventDefault()
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    if (!selected.value) return
    const { s, p } = selected.value
    const str = doc.value.strings[s]
    if (!str) return
    str.points.splice(p, 1)
    if (!str.points.length && doc.value.strings.length > 1) doc.value.strings.splice(s, 1)
    activeIdx.value = Math.min(activeIdx.value, doc.value.strings.length - 1)
    selected.value = null
    emitDoc()
    e.preventDefault()
  }
}

function reset() {
  doc.value = defaultPath()
  activeIdx.value = 0
  selected.value = null
  emitDoc()
}

// ---- SVG path data (matches sampleString's STG handle pairing) ----
function pathD(points: PathPoint[]): string {
  if (points.length < 2) return ''
  let d = `M ${px(points[0]!.x)} ${py(points[0]!.y)}`
  for (let i = 0; i < points.length - 1; i++) {
    const c1 = backHandle(points[i]!)      // reversed cubic: control1 = p[i].back
    const c2 = forwardHandle(points[i + 1]!) // control2 = p[i+1].forward
    d += ` C ${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(points[i + 1]!.x)} ${py(points[i + 1]!.y)}`
  }
  return d
}

const allStrings = computed(() => doc.value.strings)
function isSel(s: number, p: number): boolean { return selected.value?.s === s && selected.value?.p === p }
</script>

<template>
  <div ref="rootEl" class="pointer-events-none absolute inset-0">
    <svg
      class="pointer-events-auto absolute cursor-crosshair"
      :style="{ left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' }"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
    >
      <g v-for="(str, s) in allStrings" :key="s">
        <path :d="pathD(str.points)" fill="none" stroke="#3b82f6" stroke-width="1.5" opacity="0.9" />
        <template v-for="(pt, p) in str.points" :key="p">
          <!-- handle line + squares -->
          <line :x1="px(backHandle(pt).x)" :y1="py(backHandle(pt).y)"
                :x2="px(forwardHandle(pt).x)" :y2="py(forwardHandle(pt).y)"
                stroke="#ffffff" stroke-width="1" opacity="0.5" />
          <rect :x="px(forwardHandle(pt).x) - 4" :y="py(forwardHandle(pt).y) - 4" width="8" height="8"
                fill="#1e3a8a" stroke="#3b82f6" stroke-width="1" />
          <rect :x="px(backHandle(pt).x) - 4" :y="py(backHandle(pt).y) - 4" width="8" height="8"
                fill="#1e3a8a" stroke="#3b82f6" stroke-width="1" />
          <!-- point -->
          <circle :cx="px(pt.x)" :cy="py(pt.y)" r="6"
                  :fill="isSel(s, p) ? '#3b82f6' : 'rgba(0,0,0,0.25)'" stroke="#3b82f6" stroke-width="1.5" />
        </template>
      </g>
    </svg>
    <!-- toolbar -->
    <div class="pointer-events-auto absolute left-2 top-2 flex gap-1 rounded bg-black/50 px-2 py-1 text-[10px] text-white/80">
      <span class="pr-1">Drag to draw · Enter = new string · Del = remove</span>
      <button type="button" class="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" @click="reset">Reset</button>
    </div>
  </div>
</template>
