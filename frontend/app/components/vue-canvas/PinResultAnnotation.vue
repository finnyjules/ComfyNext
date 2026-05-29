<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { Trash2, ImageOff, RotateCw, Hash } from 'lucide-vue-next'
import type { PinResultAnnotation } from '~/composables/useCanvasAnnotations'

const props = defineProps<{
  annotation: PinResultAnnotation
}>()

const emit = defineEmits<{
  'drag': [id: string, dx: number, dy: number]
  'resize': [id: string, w: number, h: number]
  'update': [id: string, patch: Partial<PinResultAnnotation>]
  'remove': [id: string]
  // Future hook for "rerun with these settings" — wired but not handled yet
  // at the canvas level, so we don't break anything by emitting it.
  'rerun': [id: string]
}>()

const { viewport } = useVueFlow()

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

// Build a single-line metadata summary in declaration order so the most
// important bits (seed, model) are visible even when the strip is narrow.
const META_LABELS: Record<string, string> = {
  seed: 'seed',
  model: 'model',
  cfg: 'cfg',
  steps: 'steps',
}
const metaPills = computed(() => {
  const out: { label: string; value: string; full: string }[] = []
  for (const key of ['seed', 'model', 'cfg', 'steps']) {
    const v = (props.annotation.metadata as any)?.[key]
    if (v === undefined || v === null || v === '') continue
    const str = String(v)
    out.push({
      label: META_LABELS[key] || key,
      // Truncate long model names so a single value doesn't blow out the row.
      value: str.length > 22 ? str.slice(0, 21) + '…' : str,
      full: str,
    })
  }
  return out
})
const promptSnippet = computed(() => {
  const p = props.annotation.metadata?.prompt
  if (!p) return ''
  const trimmed = p.trim().replace(/\s+/g, ' ')
  return trimmed.length > 120 ? trimmed.slice(0, 119) + '…' : trimmed
})

// Drag / resize — same pattern as PinImageAnnotation.
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

let resizeLast: { x: number; y: number; w: number; h: number } | null = null
function onResizeDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  resizeLast = { x: e.clientX, y: e.clientY, w: props.annotation.width, h: props.annotation.height }
}
function onResizeMove(e: PointerEvent) {
  if (!resizeLast) return
  const zoom = viewport.value.zoom || 1
  const dx = (e.clientX - resizeLast.x) / zoom
  const dy = (e.clientY - resizeLast.y) / zoom
  emit('resize', props.annotation.id, resizeLast.w + dx, resizeLast.h + dy)
}
function onResizeUp(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  resizeLast = null
}

function copySeed() {
  const seed = props.annotation.metadata?.seed
  if (seed === undefined || seed === null) return
  if (navigator.clipboard) navigator.clipboard.writeText(String(seed))
}
</script>

<template>
  <div
    class="pin-result-annotation absolute pointer-events-auto"
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
    <!-- Image area: fixed top portion. Metadata strip below uses remaining
         space, so the user can resize the card to give either side priority. -->
    <div class="pin-result-annotation__frame">
      <img
        v-if="!imageLoadFailed"
        :src="annotation.src"
        :alt="annotation.caption || 'Pinned result'"
        class="pin-result-annotation__img"
        draggable="false"
        @error="onImageError"
        @load="onImageLoad"
      />
      <div v-else class="pin-result-annotation__broken">
        <ImageOff class="w-6 h-6" />
        <span>Result image unavailable</span>
      </div>

      <!-- Toolbar overlays the image (top-right). -->
      <div class="pin-result-annotation__toolbar">
        <button
          v-if="annotation.metadata?.sourceNodeId"
          type="button"
          class="pin-result-annotation__btn"
          title="Rerun this generation"
          @click.stop="emit('rerun', annotation.id)"
        >
          <RotateCw class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="pin-result-annotation__btn pin-result-annotation__btn--danger"
          title="Delete"
          @click.stop="emit('remove', annotation.id)"
        >
          <Trash2 class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Metadata strip. Always present so the card stays "result-shaped"
         even with sparse metadata. Each pill is hoverable for the full value. -->
    <div class="pin-result-annotation__meta">
      <div v-if="metaPills.length" class="pin-result-annotation__pills">
        <button
          v-for="pill in metaPills"
          :key="pill.label"
          type="button"
          class="pin-result-annotation__pill"
          :title="`${pill.label}: ${pill.full}` + (pill.label === 'seed' ? ' (click to copy)' : '')"
          :class="{ 'pin-result-annotation__pill--seed': pill.label === 'seed' }"
          @click.stop="pill.label === 'seed' ? copySeed() : null"
          @pointerdown.stop
        >
          <Hash v-if="pill.label === 'seed'" class="w-2.5 h-2.5" />
          <span class="pin-result-annotation__pill-label">{{ pill.label }}</span>
          <span class="pin-result-annotation__pill-value">{{ pill.value }}</span>
        </button>
      </div>
      <div v-if="promptSnippet" class="pin-result-annotation__prompt" :title="annotation.metadata?.prompt">
        {{ promptSnippet }}
      </div>
      <input
        v-model="captionDraft"
        class="pin-result-annotation__caption"
        placeholder="Add caption…"
        @blur="commitCaption"
        @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
        @pointerdown.stop
      />
    </div>

    <!-- Resize handle. -->
    <div
      class="pin-result-annotation__resize"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    />
  </div>
</template>

<style scoped>
.pin-result-annotation {
  display: flex;
  flex-direction: column;
  background: #14171c;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  overflow: hidden;
  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.25),
    0 10px 28px rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.9);
}

.pin-result-annotation__frame {
  position: relative;
  flex: 1;
  min-height: 80px;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.pin-result-annotation__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.pin-result-annotation__broken {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}

.pin-result-annotation__toolbar {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity 120ms;
}
.pin-result-annotation:hover .pin-result-annotation__toolbar {
  opacity: 1;
}

.pin-result-annotation__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 80ms;
}
.pin-result-annotation__btn:hover {
  background: rgba(0, 0, 0, 0.85);
}
.pin-result-annotation__btn--danger:hover {
  background: rgba(220, 38, 38, 0.8);
}

.pin-result-annotation__meta {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  flex-shrink: 0;
}

.pin-result-annotation__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pin-result-annotation__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 5px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
  cursor: default;
  transition: background 80ms;
}
.pin-result-annotation__pill--seed {
  cursor: pointer;
}
.pin-result-annotation__pill--seed:hover {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.4);
}
.pin-result-annotation__pill-label {
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.5);
}
.pin-result-annotation__pill-value {
  color: rgba(255, 255, 255, 0.95);
}

.pin-result-annotation__prompt {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.65);
  /* Two-line clamp keeps the strip from growing on long prompts. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pin-result-annotation__caption {
  background: transparent;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  padding: 2px 0;
  cursor: text;
}
.pin-result-annotation__caption::placeholder {
  color: rgba(255, 255, 255, 0.3);
  font-style: italic;
}

.pin-result-annotation__resize {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.2) 50%);
  border-bottom-right-radius: 8px;
}
</style>
