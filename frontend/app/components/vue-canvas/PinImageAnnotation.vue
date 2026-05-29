<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { Trash2, ImageOff } from 'lucide-vue-next'
import type { PinImageAnnotation } from '~/composables/useCanvasAnnotations'

const props = defineProps<{
  annotation: PinImageAnnotation
}>()

const emit = defineEmits<{
  'drag': [id: string, dx: number, dy: number]
  'resize': [id: string, w: number, h: number]
  'update': [id: string, patch: Partial<PinImageAnnotation>]
  'remove': [id: string]
}>()

const { viewport } = useVueFlow()

// Caption editing inline; keep a local draft and commit on blur.
const captionDraft = ref(props.annotation.caption ?? '')
watch(() => props.annotation.caption, (v) => { captionDraft.value = v ?? '' })
function commitCaption() {
  const next = captionDraft.value.trim()
  if (next !== (props.annotation.caption ?? '')) {
    emit('update', props.annotation.id, { caption: next || undefined })
  }
}

const imageLoadFailed = ref(false)
function onImageError() { imageLoadFailed.value = true }
function onImageLoad() { imageLoadFailed.value = false }

// Drag (header / image area). Skip on text/buttons so caption editing works.
let dragLast: { x: number; y: number } | null = null
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('button, input, textarea')) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragLast = { x: e.clientX, y: e.clientY }
}
function onPointerMove(e: PointerEvent) {
  if (!dragLast) return
  const zoom = viewport.value.zoom || 1
  const dx = (e.clientX - dragLast.x) / zoom
  const dy = (e.clientY - dragLast.y) / zoom
  dragLast = { x: e.clientX, y: e.clientY }
  emit('drag', props.annotation.id, dx, dy)
}
function onPointerUp(e: PointerEvent) {
  if (!dragLast) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  dragLast = null
}

// Resize (bottom-right). Maintain aspect ratio when Shift is held — gives
// the user a quick way to scale proportionally without dragging both axes.
let resizeLast: { x: number; y: number; w: number; h: number; aspect: number } | null = null
function onResizeDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  resizeLast = {
    x: e.clientX, y: e.clientY,
    w: props.annotation.width, h: props.annotation.height,
    aspect: props.annotation.width / Math.max(1, props.annotation.height),
  }
}
function onResizeMove(e: PointerEvent) {
  if (!resizeLast) return
  const zoom = viewport.value.zoom || 1
  const dx = (e.clientX - resizeLast.x) / zoom
  const dy = (e.clientY - resizeLast.y) / zoom
  let w = resizeLast.w + dx
  let h = resizeLast.h + dy
  if (e.shiftKey) {
    // Lock aspect: dominant axis wins.
    if (Math.abs(dx) > Math.abs(dy)) h = w / resizeLast.aspect
    else w = h * resizeLast.aspect
  }
  emit('resize', props.annotation.id, w, h)
}
function onResizeUp(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  resizeLast = null
}
</script>

<template>
  <div
    class="pin-image-annotation absolute pointer-events-auto"
    :style="{
      left: `${annotation.x}px`,
      top: `${annotation.y}px`,
      width: `${annotation.width}px`,
      height: `${annotation.height}px`,
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- Image area. Fits within the frame; the "tape" detail at the top
         hints at moodboard / reference and reads at any zoom. -->
    <div class="pin-image-annotation__tape" />
    <div class="pin-image-annotation__frame">
      <img
        v-if="!imageLoadFailed"
        :src="annotation.src"
        :alt="annotation.caption || 'Pinned image'"
        class="pin-image-annotation__img"
        draggable="false"
        @error="onImageError"
        @load="onImageLoad"
      />
      <div v-else class="pin-image-annotation__broken">
        <ImageOff class="w-6 h-6" />
        <span>Image failed to load</span>
      </div>
    </div>

    <!-- Optional caption. Always-present input so the user can add or edit
         in place; styled to look like a card label when filled, faint when empty. -->
    <input
      v-model="captionDraft"
      class="pin-image-annotation__caption"
      :class="{ 'pin-image-annotation__caption--empty': !captionDraft }"
      placeholder="Caption"
      @blur="commitCaption"
      @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
      @pointerdown.stop
    />

    <!-- Toolbar: delete only (color picker doesn't apply). -->
    <div class="pin-image-annotation__toolbar">
      <button
        type="button"
        class="pin-image-annotation__btn pin-image-annotation__btn--danger"
        title="Delete"
        @click.stop="emit('remove', annotation.id)"
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>

    <!-- Resize handle. -->
    <div
      class="pin-image-annotation__resize"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    />
  </div>
</template>

<style scoped>
.pin-image-annotation {
  display: flex;
  flex-direction: column;
  background: #fafaf7;
  border-radius: 4px;
  padding: 14px 12px 38px; /* top room for tape; bottom for caption */
  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.2),
    0 8px 22px rgba(0, 0, 0, 0.32);
}

/* Faux strip of washi tape — sits over the top edge of the card. Small
   detail, but it sells the moodboard-pin metaphor at a glance. */
.pin-image-annotation__tape {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(-2deg);
  width: 56px;
  height: 14px;
  background: rgba(252, 211, 77, 0.55);
  border: 1px solid rgba(180, 130, 0, 0.25);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}

.pin-image-annotation__frame {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  border-radius: 2px;
  overflow: hidden;
  min-height: 0;
}
.pin-image-annotation__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.pin-image-annotation__broken {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}

.pin-image-annotation__caption {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(20, 20, 20, 0.78);
  font-size: 12px;
  font-style: italic;
  text-align: center;
  cursor: text;
}
.pin-image-annotation__caption--empty {
  opacity: 0;
  transition: opacity 80ms;
}
.pin-image-annotation:hover .pin-image-annotation__caption--empty {
  opacity: 0.6;
}

.pin-image-annotation__toolbar {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms;
}
.pin-image-annotation:hover .pin-image-annotation__toolbar {
  opacity: 1;
}
.pin-image-annotation__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  transition: background 80ms;
}
.pin-image-annotation__btn:hover {
  background: rgba(0, 0, 0, 0.65);
}
.pin-image-annotation__btn--danger:hover {
  background: rgba(220, 38, 38, 0.8);
}

.pin-image-annotation__resize {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(0, 0, 0, 0.3) 50%);
  border-bottom-right-radius: 4px;
}
</style>
