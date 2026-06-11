<script setup lang="ts">
/**
 * Drag-a-crosshair focal point picker for image elements. The focal point
 * (0–1 × 0–1) steers cover crops across formats — wide banners keep this
 * part of the image in frame.
 */
const props = defineProps<{
  focal: { x: number; y: number }
  src?: string
}>()

const emit = defineEmits<{ change: [focal: { x: number; y: number }] }>()

const boxRef = ref<HTMLDivElement | null>(null)
let dragging = false

function apply(e: PointerEvent) {
  const box = boxRef.value
  if (!box) return
  const r = box.getBoundingClientRect()
  emit('change', {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  })
}

function onDown(e: PointerEvent) {
  dragging = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  apply(e)
}
function onMove(e: PointerEvent) { if (dragging) apply(e) }
function onUp(e: PointerEvent) {
  dragging = false
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
}
</script>

<template>
  <div>
    <div
      ref="boxRef"
      class="relative w-full aspect-video rounded border border-white/10 overflow-hidden cursor-crosshair select-none"
      :style="src
        ? { background: `url(${src}) center / cover no-repeat` }
        : { background: 'repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 50% / 16px 16px' }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      <div
        class="absolute size-4 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        :style="{ left: `${props.focal.x * 100}%`, top: `${props.focal.y * 100}%` }"
      >
        <div class="absolute inset-0 rounded-full border-2 border-[#96b4ff] bg-[#96b4ff]/20" />
        <div class="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
      </div>
    </div>
    <div class="mt-1 text-[10px] text-white/35 tabular-nums">
      Focal {{ Math.round(props.focal.x * 100) }}%, {{ Math.round(props.focal.y * 100) }}% — kept in frame when formats crop
    </div>
  </div>
</template>
