<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { Trash2, Plus, Check, GripVertical } from 'lucide-vue-next'
import type { ChecklistAnnotation, ChecklistItem } from '~/composables/useCanvasAnnotations'

const props = defineProps<{
  annotation: ChecklistAnnotation
}>()

const emit = defineEmits<{
  'drag': [id: string, dx: number, dy: number]
  'resize': [id: string, w: number, h: number]
  'update': [id: string, patch: Partial<ChecklistAnnotation>]
  'remove': [id: string]
}>()

const { viewport } = useVueFlow()

// Title editing.
const titleDraft = ref(props.annotation.title)
watch(() => props.annotation.title, (v) => { titleDraft.value = v })
function commitTitle() {
  if (titleDraft.value.trim() && titleDraft.value !== props.annotation.title) {
    emit('update', props.annotation.id, { title: titleDraft.value.trim() })
  }
}

// Items: we keep a local working copy so an in-progress add doesn't immediately
// re-render through the prop and lose focus on the input. Sync back via emit.
//
// JSON round-trip rather than `structuredClone` — Vue reactive proxies wrap
// objects with Symbols that structuredClone refuses with DataCloneError. The
// rest of the codebase already standardizes on this approach (see
// useTemplateEditor.ts) for the same reason.
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

const itemsDraft = ref<ChecklistItem[]>(clone(props.annotation.items ?? []))
watch(() => props.annotation.items, (v) => {
  if (!v) return
  // Only re-pull from props when the external value diverges meaningfully —
  // checking length + done states is enough to ignore our own emits coming back.
  if (v.length !== itemsDraft.value.length
      || v.some((it, i) => it.id !== itemsDraft.value[i]?.id || it.done !== itemsDraft.value[i]?.done)) {
    itemsDraft.value = clone(v)
  }
}, { deep: true })

function persistItems() {
  emit('update', props.annotation.id, { items: clone(itemsDraft.value) })
}

function addItem() {
  itemsDraft.value.push({ id: `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, text: '', done: false })
  persistItems()
  // Focus the new input on next tick.
  nextTick(() => {
    const inputs = document.querySelectorAll(`[data-checklist-id="${props.annotation.id}"] [data-item-input]`)
    const last = inputs[inputs.length - 1] as HTMLInputElement | undefined
    last?.focus()
  })
}

function toggleItem(idx: number) {
  const it = itemsDraft.value[idx]
  if (!it) return
  it.done = !it.done
  persistItems()
}

function updateItemText(idx: number, text: string) {
  const it = itemsDraft.value[idx]
  if (!it) return
  it.text = text
  persistItems()
}

function removeItem(idx: number) {
  itemsDraft.value.splice(idx, 1)
  persistItems()
}

// Press Enter at end of an item → add a new one below.
function onItemKey(e: KeyboardEvent, idx: number) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addItem()
  } else if (e.key === 'Backspace' && (e.target as HTMLInputElement).value === '' && itemsDraft.value.length > 1) {
    e.preventDefault()
    removeItem(idx)
    nextTick(() => {
      const inputs = document.querySelectorAll(`[data-checklist-id="${props.annotation.id}"] [data-item-input]`)
      const prev = inputs[Math.max(0, idx - 1)] as HTMLInputElement | undefined
      prev?.focus()
    })
  }
}

// Drag (from header / grip).
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

// Resize.
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

const doneCount = computed(() => itemsDraft.value.filter(it => it.done).length)
</script>

<template>
  <div
    class="checklist-annotation absolute pointer-events-auto"
    :style="{
      left: `${annotation.x}px`,
      top: `${annotation.y}px`,
      width: `${annotation.width}px`,
      height: `${annotation.height}px`,
    }"
    :data-checklist-id="annotation.id"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- Header: drag handle + title + counter + delete. -->
    <div class="checklist-annotation__header">
      <GripVertical class="checklist-annotation__grip w-3 h-3" />
      <input
        v-model="titleDraft"
        class="checklist-annotation__title"
        placeholder="Checklist"
        @blur="commitTitle"
        @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
        @pointerdown.stop
      />
      <span class="checklist-annotation__count">{{ doneCount }}/{{ itemsDraft.length }}</span>
      <button
        type="button"
        class="checklist-annotation__btn checklist-annotation__btn--danger"
        title="Delete"
        @click.stop="emit('remove', annotation.id)"
      >
        <Trash2 class="w-3 h-3" />
      </button>
    </div>

    <!-- Items list. Empty state explains how to start. -->
    <div class="checklist-annotation__body">
      <div v-if="itemsDraft.length === 0" class="checklist-annotation__empty">
        No items yet — click + to add one
      </div>
      <div
        v-for="(it, idx) in itemsDraft"
        :key="it.id"
        class="checklist-annotation__item"
        :class="{ 'checklist-annotation__item--done': it.done }"
      >
        <button
          type="button"
          class="checklist-annotation__check"
          :class="{ 'checklist-annotation__check--done': it.done }"
          :aria-label="it.done ? 'Mark not done' : 'Mark done'"
          @click.stop="toggleItem(idx)"
        >
          <Check v-if="it.done" class="w-3 h-3" />
        </button>
        <input
          :value="it.text"
          data-item-input
          class="checklist-annotation__item-text"
          placeholder="What to try…"
          @input="(e) => updateItemText(idx, (e.target as HTMLInputElement).value)"
          @keydown="(e) => onItemKey(e, idx)"
          @pointerdown.stop
        />
        <button
          type="button"
          class="checklist-annotation__btn checklist-annotation__item-remove"
          aria-label="Remove item"
          @click.stop="removeItem(idx)"
        >
          <Trash2 class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Footer: add button. Sticky to the bottom so it's reachable even when
         the body scrolls. -->
    <div class="checklist-annotation__footer">
      <button
        type="button"
        class="checklist-annotation__add"
        @click.stop="addItem"
      >
        <Plus class="w-3 h-3" />
        <span>Add item</span>
      </button>
    </div>

    <!-- Resize handle. -->
    <div
      class="checklist-annotation__resize"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    />
  </div>
</template>

<style scoped>
.checklist-annotation {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: #1f2937;
  border: 1px solid rgba(148, 163, 184, 0.25);
  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.2),
    0 6px 18px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
}

.checklist-annotation__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  cursor: grab;
}
.checklist-annotation__header:active {
  cursor: grabbing;
}
.checklist-annotation__grip {
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
}
.checklist-annotation__title {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.95);
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
  cursor: text;
}
.checklist-annotation__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.07);
  padding: 2px 6px;
  border-radius: 4px;
}

.checklist-annotation__body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.checklist-annotation__empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
}

.checklist-annotation__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  transition: background 80ms;
}
.checklist-annotation__item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.checklist-annotation__item--done .checklist-annotation__item-text {
  color: rgba(255, 255, 255, 0.4);
  text-decoration: line-through;
}

.checklist-annotation__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: transparent;
  border: 1.5px solid rgba(148, 163, 184, 0.5);
  color: white;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 80ms, border-color 80ms;
}
.checklist-annotation__check:hover {
  border-color: rgba(148, 163, 184, 0.9);
}
.checklist-annotation__check--done {
  background: rgb(74, 222, 128);
  border-color: rgb(74, 222, 128);
  color: rgb(15, 23, 42);
}

.checklist-annotation__item-text {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  padding: 2px 0;
  cursor: text;
}
.checklist-annotation__item-text::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.checklist-annotation__item-remove {
  opacity: 0;
  transition: opacity 80ms;
}
.checklist-annotation__item:hover .checklist-annotation__item-remove {
  opacity: 1;
}

.checklist-annotation__footer {
  padding: 6px 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(255, 255, 255, 0.02);
}
.checklist-annotation__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: background 80ms, color 80ms;
}
.checklist-annotation__add:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.95);
}

.checklist-annotation__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 80ms, color 80ms;
}
.checklist-annotation__btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
}
.checklist-annotation__btn--danger:hover {
  background: rgba(220, 38, 38, 0.22);
  color: rgb(254, 202, 202);
}

.checklist-annotation__resize {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.18) 50%);
  border-bottom-right-radius: 6px;
}
</style>
