<!-- frontend/app/components/vue-canvas/LoftSpineEditor.vue -->
<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { parseStops, serializeStops, autoSmoothStops, type LoftStop } from '~/lib/spacetype/loftStops'

/**
 * Interactive on-preview spine editor for the Loft effect (STG /loft). An SVG overlay tracking
 * the preview canvas's on-screen rectangle — same mechanics as StringPathEditor (canvas-rect
 * tracking, normalized pointer mapping, point + tangent-handle drag, self-echo guard), but
 * driving LoftStop's x/y + bezier tangent fields (`ta`/`hlf`/`hlb`) instead of PathPoint's
 * a/hl/althl. Drag a spine node to move it — `autoSmoothStops` re-derives every non-manual
 * neighbour's tangents so the curve stays smooth; manual stops keep theirs. Drag a tangent
 * handle (shown only for the selected stop, to match StringPathEditor's affordance density) to
 * hand-tune that stop's curve, which flips it to manual. Click empty canvas to append a new
 * stop; Delete removes the selected one. Every other field (z, width, height, roll, color, id)
 * passes through untouched — this editor only ever writes x, y, ta, hlf, hlb, manual.
 *
 * `closed` (optional, default false) mirrors params.closed on the Loft effect: when true, the
 * drawn spine gets one extra closing segment from the last stop back to the first, matching
 * sampleSpine's own closed-loop wrap (loftGeometry.ts). Purely cosmetic here — it does not add
 * or remove a stop, only how the path is drawn.
 */

const props = withDefaults(
  defineProps<{ modelValue: string; canvas: HTMLCanvasElement | null; closed?: boolean }>(),
  { closed: false },
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const rootEl = ref<HTMLDivElement | null>(null)
const stops = reactive<LoftStop[]>(parseStops(props.modelValue))
const selectedId = ref<string>(stops[0]?.id ?? '')

// Effective (auto-smoothed) stops used for DRAWING only — mirrors sampleSpine/segEditor's own
// call to autoSmoothStops (loftGeometry.ts) so the overlay's curve matches the rendered loft
// exactly. Manual stops pass through unchanged; non-manual stops get fresh tangents derived
// from their neighbours. The raw `stops` array (what gets emitted) is left as-is for non-manual
// stops — the geometry pipeline re-derives them the same way at every render, so nothing is lost.
const smoothed = computed<LoftStop[]>(() => autoSmoothStops(stops))
const selectedStop = computed<LoftStop | undefined>(() => smoothed.value.find(s => s.id === selectedId.value))

let lastEmitted = props.modelValue
watch(() => props.modelValue, (v) => {
  if (v === lastEmitted) return // ignore our own echo
  const next = parseStops(v)
  stops.splice(0, stops.length, ...next)
  if (!stops.find(s => s.id === selectedId.value)) selectedId.value = stops[0]?.id ?? ''
})

function emitStops() {
  lastEmitted = serializeStops(stops)
  emit('update:modelValue', lastEmitted)
}

// ---- on-screen box of the canvas, relative to this overlay's root (verbatim from StringPathEditor) ----
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
// y=0 is TOP, y=1 is BOTTOM — the plain canvas-pixel convention, identical to StringPathEditor's
// toNorm below. This matches loftGeometry.ts's worldFromEditor, which flips y itself
// (`y: (0.5 - e.y) * 8`) to turn top-of-screen into +Y (up) in world space — so the editor's own
// mapping must stay un-flipped for a dragged point to land under the cursor.
function toNorm(e: PointerEvent): { x: number; y: number } {
  const x = (e.clientX - (props.canvas?.getBoundingClientRect().left ?? 0)) / box.width
  const y = (e.clientY - (props.canvas?.getBoundingClientRect().top ?? 0)) / box.height
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}
// The <svg> is itself absolutely positioned at (box.left, box.top) (see :style below),
// so its internal origin already sits at the canvas top-left. Map normalized→svg-internal
// with box.width/height ONLY — adding box.left/top again double-counts the offset and
// shifts every node/handle away from the cursor whenever the canvas is letterboxed in a
// wider/taller preview (dormant only while box.left/top are ~0).
const px = (nx: number) => nx * box.width
const py = (ny: number) => ny * box.height

// Hit threshold in normalized units (~10 px on each axis).
const hitX = () => 10 / box.width
const hitY = () => 10 / box.height
function near(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= hitX() && Math.abs(ay - by) <= hitY()
}

// Tangent-handle endpoints — the SAME construction loftGeometry.ts's segEditor() uses so the
// drawn handles line up with the actual curve control points:
//   forward = point + (cos ta, sin ta)·hlf,  back = point − (cos ta, sin ta)·hlb
function fwdHandle(s: LoftStop): { x: number; y: number } {
  const ta = s.ta ?? 0, hlf = s.hlf ?? 0
  return { x: s.x + Math.cos(ta) * hlf, y: s.y + Math.sin(ta) * hlf }
}
function backHandle(s: LoftStop): { x: number; y: number } {
  const ta = s.ta ?? 0, hlb = s.hlb ?? 0
  return { x: s.x - Math.cos(ta) * hlb, y: s.y - Math.sin(ta) * hlb }
}

let localIdSeq = 0
function newLocalId(): string { localIdSeq += 1; return `s${Date.now().toString(36)}${localIdSeq}` }

// ---- interaction state ----
type Drag =
  | { kind: 'point'; id: string; ox: number; oy: number }
  | { kind: 'fwd'; id: string }
  | { kind: 'back'; id: string }
let drag: Drag | null = null

function hitTest(np: { x: number; y: number }): Drag | null {
  // Handles first (they sit on top), and only for the SELECTED stop — showing every stop's
  // handles at once would clutter the preview (match StringPathEditor's affordance density).
  const sel = selectedStop.value
  if (sel) {
    const f = fwdHandle(sel), b = backHandle(sel)
    if (near(np.x, np.y, f.x, f.y)) return { kind: 'fwd', id: sel.id }
    if (near(np.x, np.y, b.x, b.y)) return { kind: 'back', id: sel.id }
  }
  for (const s of stops) {
    if (near(np.x, np.y, s.x, s.y)) return { kind: 'point', id: s.id, ox: s.x - np.x, oy: s.y - np.y }
  }
  return null
}

function onPointerDown(e: PointerEvent) {
  updateBox()
  const np = toNorm(e)
  const hit = hitTest(np)
  if (hit) {
    drag = hit
    selectedId.value = hit.id
  } else {
    // Empty space → append a new stop at the click, copying non-geometry fields (z/width/height/
    // roll/color) from the last stop — matches ProfileStopsEditor.addStop's neighbour-copy and
    // StringPathEditor's empty-click add. Tangents are left undefined so autoSmoothStops derives
    // them fresh from the new neighbour geometry.
    const last = stops[stops.length - 1]
    const stop: LoftStop = last
      ? { id: newLocalId(), x: np.x, y: np.y, z: last.z, width: last.width, height: last.height, roll: last.roll, color: last.color }
      : { id: newLocalId(), x: np.x, y: np.y, z: 0, width: 1, height: 1, roll: 0, color: '#ffffff' }
    stops.push(stop)
    drag = { kind: 'point', id: stop.id, ox: 0, oy: 0 }
    selectedId.value = stop.id
  }
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const np = toNorm(e)
  const s = stops.find(st => st.id === drag!.id)
  if (!s) return
  if (drag.kind === 'point') {
    s.x = Math.min(1, Math.max(0, np.x + drag.ox))
    s.y = Math.min(1, Math.max(0, np.y + drag.oy))
  } else if (drag.kind === 'fwd') {
    // Collinear-tangent, independent-length model (same as StringPathEditor's 'fwd' branch):
    // rotating the forward handle re-aims the shared angle `ta` (so the back handle rotates with
    // it), but only the forward length `hlf` changes — `hlb` is left as-is.
    s.ta = Math.atan2(np.y - s.y, np.x - s.x)
    s.hlf = Math.hypot(np.x - s.x, np.y - s.y)
    s.manual = true
  } else if (drag.kind === 'back') {
    // Back handle points in the −ta direction → ta aims opposite the drag target.
    s.ta = Math.atan2(np.y - s.y, np.x - s.x) + Math.PI
    s.hlb = Math.hypot(np.x - s.x, np.y - s.y)
    s.manual = true
  }
}

function onPointerUp(e: PointerEvent) {
  if (drag) { emitStops(); drag = null }
  ;(e.target as Element).releasePointerCapture?.(e.pointerId)
}

function onKey(e: KeyboardEvent) {
  // Ignore when typing in an input elsewhere in the editor panel.
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (stops.length <= 2) return
    const i = stops.findIndex(s => s.id === selectedId.value)
    if (i < 0) return
    stops.splice(i, 1)
    selectedId.value = stops[Math.min(i, stops.length - 1)]?.id ?? ''
    emitStops()
    e.preventDefault()
  }
}

// Reverts the selected stop to auto-derived tangents (clears `manual`); autoSmoothStops picks it
// back up on the next `smoothed` read.
function setAuto() {
  const s = stops.find(st => st.id === selectedId.value)
  if (!s || !s.manual) return
  s.manual = false
  emitStops()
}

function deleteSelected() {
  if (stops.length <= 2) return
  const i = stops.findIndex(s => s.id === selectedId.value)
  if (i < 0) return
  stops.splice(i, 1)
  selectedId.value = stops[Math.min(i, stops.length - 1)]?.id ?? ''
  emitStops()
}

// ---- SVG path data (matches loftGeometry.ts's segEditor/posAtU handle pairing) ----
// When `closed`, append one more cubic segment wrapping n-1 -> 0 (last stop back to the
// first), using the same fwdHandle/backHandle pairing as every other segment — this is
// exactly the extra "seg" sampleSpine (loftGeometry.ts) walks when `closed` is true (see
// `const seg = closed ? n : n - 1`), so the drawn spine matches the rendered closed loft.
function pathD(pts: LoftStop[]): string {
  if (pts.length < 2) return ''
  let d = `M ${px(pts[0]!.x)} ${py(pts[0]!.y)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const c1 = fwdHandle(a)      // segEditor: p1 = a + forward(a.ta, a.hlf)
    const c2 = backHandle(b)     // segEditor: p2 = b - forward(b.ta, b.hlb)
    d += ` C ${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(b.x)} ${py(b.y)}`
  }
  if (props.closed) {
    const a = pts[pts.length - 1]!, b = pts[0]!
    const c1 = fwdHandle(a)
    const c2 = backHandle(b)
    d += ` C ${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(b.x)} ${py(b.y)}`
  }
  return d
}

function isSel(id: string): boolean { return selectedId.value === id }
</script>

<template>
  <div ref="rootEl" class="pointer-events-none absolute inset-0">
    <svg
      class="pointer-events-auto absolute cursor-crosshair"
      :style="{ left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' }"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
    >
      <path :d="pathD(smoothed)" fill="none" stroke="#3b82f6" stroke-width="1.5" opacity="0.9" />
      <template v-for="s in smoothed" :key="s.id">
        <!-- handle line + squares (selected stop only) -->
        <template v-if="isSel(s.id)">
          <line :x1="px(backHandle(s).x)" :y1="py(backHandle(s).y)"
                :x2="px(fwdHandle(s).x)" :y2="py(fwdHandle(s).y)"
                stroke="#ffffff" stroke-width="1" opacity="0.5" />
          <rect :x="px(fwdHandle(s).x) - 4" :y="py(fwdHandle(s).y) - 4" width="8" height="8"
                fill="#1e3a8a" stroke="#3b82f6" stroke-width="1" />
          <rect :x="px(backHandle(s).x) - 4" :y="py(backHandle(s).y) - 4" width="8" height="8"
                fill="#1e3a8a" stroke="#3b82f6" stroke-width="1" />
        </template>
        <!-- node -->
        <circle :cx="px(s.x)" :cy="py(s.y)" r="6"
                :fill="isSel(s.id) ? '#3b82f6' : 'rgba(0,0,0,0.25)'" stroke="#3b82f6" stroke-width="1.5" />
      </template>
    </svg>
    <!-- toolbar -->
    <div class="pointer-events-auto absolute left-2 top-2 flex flex-wrap items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-[10px] text-white/80">
      <span class="text-white/45">Drag nodes · select + drag handles to hand-tune · click empty space to add · Del removes</span>
      <button v-if="selectedStop?.manual" type="button" class="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" @click="setAuto">Auto tangent</button>
      <button type="button" class="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20" :disabled="stops.length <= 2" @click="deleteSelected">Delete stop</button>
    </div>
  </div>
</template>
