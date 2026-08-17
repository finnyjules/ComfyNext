<!-- frontend/app/components/vue-canvas/CurveHandleEditor.vue -->
<script setup lang="ts">
import { reactive, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { CurveConfig } from '~/lib/gradientfx/types'

/**
 * Interactive on-preview handle overlay for the Gradient Studio `curve` layout
 * (`layer.curve.*` dials). Three draggable handles — start, end, and a curvature
 * "bow" handle at the chord midpoint — write straight back into the dials; the
 * shader/`buildCurvePolyline` (curvePath.ts) remain the sole source of truth for
 * the sampled curve, this component only ever edits the parametric fields.
 *
 * Named CurveHandleEditor (not CurveEditor) deliberately — `~/components/vue-canvas/
 * CurveEditor.vue` already exists and is a DIFFERENT component: the draggable
 * cubic-bezier EASING graph (ControlSpec kind `'curve'`, used by SpaceTypeSurface
 * and Scene3DStudioSurface for motion easing). Reusing that name here would have
 * silently overwritten it.
 *
 * Canvas-rect tracking mirrors StringPathEditor.vue/LoftSpineEditor.vue verbatim:
 * an `absolute inset-0` root, a `box` reactive rect (canvas position relative to
 * the root, kept in sync via ResizeObserver + a light rAF tick), and a self-echo-
 * free normalized-pointer mapping. Coordinate convention is y=0 TOP (plain canvas-
 * pixel space) — same as the sibling editors. The flip to shader space happens
 * later, in renderer.ts's `uploadCurve` (Task 4); this component must NOT flip.
 */

const props = defineProps<{ modelValue: CurveConfig; canvas: HTMLCanvasElement | null }>()
const emit = defineEmits<{ (e: 'edit', path: string, value: number): void }>()

const rootEl = ref<HTMLDivElement | null>(null)

// On-screen box of the canvas, relative to this overlay's root (verbatim from
// StringPathEditor/LoftSpineEditor).
const box = reactive({ left: 0, top: 0, width: 1, height: 1 })
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
  ro = new ResizeObserver(updateBox)
  if (props.canvas) ro.observe(props.canvas)
  if (rootEl.value) ro.observe(rootEl.value)
  window.addEventListener('resize', updateBox)
  // A light rAF keeps the box synced through layout shifts ResizeObserver misses
  // (e.g. the preview's pan/zoom transform, panel open/close).
  const tick = () => { updateBox(); rafId = requestAnimationFrame(tick) }
  rafId = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', updateBox)
  if (rafId) cancelAnimationFrame(rafId)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
})

// ---- coordinate helpers (normalized [0,1] ↔ overlay px, root-relative) ----
function toNorm(e: PointerEvent): { x: number; y: number } {
  const x = (e.clientX - (props.canvas?.getBoundingClientRect().left ?? 0)) / box.width
  const y = (e.clientY - (props.canvas?.getBoundingClientRect().top ?? 0)) / box.height
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}
function toScreen(x: number, y: number): { left: number; top: number } {
  return { left: box.left + x * box.width, top: box.top + y * box.height }
}

// ---- derived handle positions ----
const start = computed(() => props.modelValue.start)
const end = computed(() => props.modelValue.end)
const screenStart = computed(() => toScreen(start.value.x, start.value.y))
const screenEnd = computed(() => toScreen(end.value.x, end.value.y))
const mid = computed(() => ({ x: (start.value.x + end.value.x) / 2, y: (start.value.y + end.value.y) / 2 }))
const screenMid = computed(() => toScreen(mid.value.x, mid.value.y))
// Chord unit + its perpendicular — same construction as curvePath.ts's evalCurve,
// so the curvature handle sits exactly where the 'arc' shape's own midpoint bows to.
const chordPerp = computed(() => {
  const dx = end.value.x - start.value.x, dy = end.value.y - start.value.y
  const L = Math.hypot(dx, dy) || 1e-6
  return { x: -dy / L, y: dx / L }
})
const ctrl = computed(() => {
  const off = props.modelValue.curvature * props.modelValue.bend * 0.5
  const p = chordPerp.value
  return { x: mid.value.x + p.x * off, y: mid.value.y + p.y * off }
})
const screenCtrl = computed(() => toScreen(ctrl.value.x, ctrl.value.y))
// The curvature handle only means something once the shape actually bows — matches
// the `layer.curve.curvature`/`bend` sliders' own visibility rule in controls.ts.
const showCurvature = computed(() => props.modelValue.shape !== 'line')

// ---- drag state ----
type DragKind = 'start' | 'end' | 'curvature'
let dragKind: DragKind | null = null

function beginDrag(kind: DragKind, e: PointerEvent) {
  updateBox()
  dragKind = kind
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  e.preventDefault()
}
function onMove(e: PointerEvent) {
  if (!dragKind) return
  const np = toNorm(e)
  if (dragKind === 'start' || dragKind === 'end') {
    emit('edit', `layer.curve.${dragKind}.x`, np.x)
    emit('edit', `layer.curve.${dragKind}.y`, np.y)
    return
  }
  // Curvature handle: project the pointer offset from the chord midpoint onto the
  // chord-perpendicular. Magnitude (clamped 0..1) → curvature; sign → bend (±1).
  const p = chordPerp.value, m = mid.value
  const signed = ((np.x - m.x) * p.x + (np.y - m.y) * p.y) / 0.5
  emit('edit', 'layer.curve.curvature', Math.min(1, Math.abs(signed)))
  emit('edit', 'layer.curve.bend', signed >= 0 ? 1 : -1)
}
function onUp() {
  dragKind = null
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
}
</script>

<template>
  <div ref="rootEl" class="pointer-events-none absolute inset-0">
    <svg class="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <line :x1="screenStart.left" :y1="screenStart.top" :x2="screenEnd.left" :y2="screenEnd.top"
            stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-dasharray="4 4" />
      <line v-if="showCurvature" :x1="screenMid.left" :y1="screenMid.top" :x2="screenCtrl.left" :y2="screenCtrl.top"
            stroke="rgba(59,130,246,0.6)" stroke-width="1" />
    </svg>
    <button type="button"
            class="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-blue-400 bg-white shadow-md transition hover:scale-110 active:cursor-grabbing"
            :style="{ left: screenStart.left + 'px', top: screenStart.top + 'px' }"
            title="Start" @pointerdown="beginDrag('start', $event)" />
    <button type="button"
            class="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-blue-400 bg-white shadow-md transition hover:scale-110 active:cursor-grabbing"
            :style="{ left: screenEnd.left + 'px', top: screenEnd.top + 'px' }"
            title="End" @pointerdown="beginDrag('end', $event)" />
    <button v-if="showCurvature" type="button"
            class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-blue-500/80 shadow-md transition hover:scale-110 active:cursor-grabbing"
            :style="{ left: screenCtrl.left + 'px', top: screenCtrl.top + 'px' }"
            title="Curvature" @pointerdown="beginDrag('curvature', $event)" />
  </div>
</template>
