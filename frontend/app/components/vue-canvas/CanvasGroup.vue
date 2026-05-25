<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { Play, Ban, EyeOff, Boxes } from 'lucide-vue-next'
import type { CanvasGroup } from '~/composables/useCanvasGroups'

const props = defineProps<{
  group: CanvasGroup
  // Aggregate mode of the group's contained nodes — driven by the parent.
  // 'mixed' means some nodes are at that mode but not all; 'all' means every
  // contained node is at that mode. Used to highlight the toggle buttons.
  bypassState?: 'none' | 'mixed' | 'all'
  muteState?: 'none' | 'mixed' | 'all'
}>()

const emit = defineEmits<{
  'drag-start': [groupId: string]
  'drag': [groupId: string, dx: number, dy: number]
  'drag-end': [groupId: string]
  'resize': [groupId: string, width: number, height: number]
  'context-menu': [groupId: string, x: number, y: number]
  'title-edit': [groupId: string, title: string]
  'run': [groupId: string]
  'toggle-bypass': [groupId: string]
  'toggle-mute': [groupId: string]
  'save-as-block': [groupId: string]
}>()

const { viewport } = useVueFlow()

const TITLE_BAR_HEIGHT = 28
const RESIZE_HANDLE_SIZE = 14

const isEditingTitle = ref(false)
const titleDraft = ref(props.group.title)

watch(() => props.group.title, (v) => { titleDraft.value = v })

// Pointer-driven drag of the title bar. Coordinates are converted from screen
// to graph space using the current zoom, so drag distance is preserved across
// zoom levels.
let dragLast: { x: number; y: number } | null = null
let dragMoved = false

function onTitlePointerDown(e: PointerEvent) {
  if (isEditingTitle.value) return
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragLast = { x: e.clientX, y: e.clientY }
  dragMoved = false
  emit('drag-start', props.group.id)
}

function onTitlePointerMove(e: PointerEvent) {
  if (!dragLast) return
  const zoom = viewport.value.zoom || 1
  const dx = (e.clientX - dragLast.x) / zoom
  const dy = (e.clientY - dragLast.y) / zoom
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) dragMoved = true
  dragLast = { x: e.clientX, y: e.clientY }
  emit('drag', props.group.id, dx, dy)
}

function onTitlePointerUp(e: PointerEvent) {
  if (!dragLast) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  dragLast = null
  emit('drag-end', props.group.id)
}

// Resize drag (bottom-right handle only).
let resizeLast: { x: number; y: number; w: number; h: number } | null = null
function onResizePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  resizeLast = { x: e.clientX, y: e.clientY, w: props.group.width, h: props.group.height }
}
function onResizePointerMove(e: PointerEvent) {
  if (!resizeLast) return
  const zoom = viewport.value.zoom || 1
  const dx = (e.clientX - resizeLast.x) / zoom
  const dy = (e.clientY - resizeLast.y) / zoom
  emit('resize', props.group.id, resizeLast.w + dx, resizeLast.h + dy)
}
function onResizePointerUp(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  resizeLast = null
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  emit('context-menu', props.group.id, e.clientX, e.clientY)
}

function startEditTitle() {
  if (dragMoved) return
  isEditingTitle.value = true
  titleDraft.value = props.group.title
  nextTick(() => {
    const input = document.querySelector(`[data-group-title-input="${props.group.id}"]`) as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

function commitTitle() {
  if (titleDraft.value.trim()) {
    emit('title-edit', props.group.id, titleDraft.value.trim())
  }
  isEditingTitle.value = false
}

function cancelEditTitle() {
  titleDraft.value = props.group.title
  isEditingTitle.value = false
}

// Tinted-fill rgba derived from the group color (low alpha for body, higher
// for the title bar). Falls back gracefully if the hex isn't 6 chars.
const fillBody = computed(() => hexToRgba(props.group.color, 0.06))
const fillTitle = computed(() => hexToRgba(props.group.color, 0.18))
const strokeColor = computed(() => hexToRgba(props.group.color, 0.6))

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{6})$/i.exec(hex)
  if (!m) return `rgba(255,255,255,${alpha})`
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

const bypassClass = computed(() => {
  if (props.bypassState === 'all') return 'canvas-group__action--bypass-on'
  if (props.bypassState === 'mixed') return 'canvas-group__action--mixed'
  return ''
})
const muteClass = computed(() => {
  if (props.muteState === 'all') return 'canvas-group__action--mute-on'
  if (props.muteState === 'mixed') return 'canvas-group__action--mixed'
  return ''
})
</script>

<template>
  <div
    class="canvas-group absolute pointer-events-none"
    :style="{
      left: `${group.x}px`,
      top: `${group.y}px`,
      width: `${group.width}px`,
      height: `${group.height}px`,
    }"
    :data-group-id="group.id"
  >
    <!-- Body: dashed border + translucent fill. Pointer-events none so clicks
         on the empty area inside the group fall through to nodes (and to the
         pane for empty space). Group interactions live on the title bar and
         resize handle below. -->
    <div
      class="absolute inset-0 rounded-lg pointer-events-none"
      :style="{
        background: fillBody,
        border: `1.5px dashed ${strokeColor}`,
      }"
    />

    <!-- Title bar: drag handle + group context menu target. Pointer events
         re-enabled here only, so the rest of the group is click-through. -->
    <div
      class="canvas-group__title absolute top-0 left-0 right-0 flex items-center gap-2 px-2.5 rounded-t-lg cursor-grab active:cursor-grabbing select-none pointer-events-auto"
      :style="{
        height: `${TITLE_BAR_HEIGHT}px`,
        background: fillTitle,
        borderBottom: `1px solid ${strokeColor}`,
      }"
      @pointerdown="onTitlePointerDown"
      @pointermove="onTitlePointerMove"
      @pointerup="onTitlePointerUp"
      @pointercancel="onTitlePointerUp"
      @dblclick="startEditTitle"
      @contextmenu="onContextMenu"
    >
      <span
        class="w-2.5 h-2.5 rounded-full shrink-0 border border-white/30"
        :style="{ backgroundColor: group.color }"
      />
      <input
        v-if="isEditingTitle"
        v-model="titleDraft"
        :data-group-title-input="group.id"
        class="flex-1 bg-transparent text-white/90 text-[13px] font-medium outline-none border-b border-white/30"
        @blur="commitTitle"
        @keydown.enter.prevent="commitTitle"
        @keydown.escape.prevent="cancelEditTitle"
        @pointerdown.stop
      />
      <span
        v-else
        class="flex-1 text-white/90 text-[13px] font-medium truncate"
      >{{ group.title }}</span>

      <!-- Quick actions. Stop propagation so they don't kick off a drag. -->
      <div class="flex items-center gap-0.5 shrink-0 -mr-1">
        <button
          type="button"
          class="canvas-group__action canvas-group__action--run"
          title="Run group"
          aria-label="Run group"
          @pointerdown.stop
          @click.stop="emit('run', group.id)"
        >
          <Play class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="canvas-group__action"
          :class="bypassClass"
          :title="bypassState === 'all' ? 'Un-bypass group nodes' : 'Bypass group nodes'"
          aria-label="Toggle bypass for group nodes"
          @pointerdown.stop
          @click.stop="emit('toggle-bypass', group.id)"
        >
          <Ban class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="canvas-group__action"
          :class="muteClass"
          :title="muteState === 'all' ? 'Un-mute group nodes' : 'Mute group nodes'"
          aria-label="Toggle mute for group nodes"
          @pointerdown.stop
          @click.stop="emit('toggle-mute', group.id)"
        >
          <EyeOff class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="canvas-group__action canvas-group__action--save"
          title="Save as Block…"
          aria-label="Save group as block"
          @pointerdown.stop
          @click.stop="emit('save-as-block', group.id)"
        >
          <Boxes class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Bottom-right resize handle. Pointer events re-enabled. -->
    <div
      class="absolute bottom-0 right-0 cursor-nwse-resize pointer-events-auto"
      :style="{
        width: `${RESIZE_HANDLE_SIZE}px`,
        height: `${RESIZE_HANDLE_SIZE}px`,
        background: `linear-gradient(135deg, transparent 50%, ${strokeColor} 50%)`,
        borderBottomRightRadius: '6px',
      }"
      @pointerdown="onResizePointerDown"
      @pointermove="onResizePointerMove"
      @pointerup="onResizePointerUp"
      @pointercancel="onResizePointerUp"
    />
  </div>
</template>

<style scoped>
.canvas-group {
  /* Sit above the dot grid (z=0) but below VueFlow's node layer (z=1+).
     Title bar / resize handle re-enable pointer events locally. */
  z-index: 0;
}

.canvas-group__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.55);
  background: transparent;
  transition: background-color 120ms, color 120ms;
  cursor: pointer;
}
.canvas-group__action:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
}

/* Run: subtle green tint on hover so it reads as the primary action. */
.canvas-group__action--run:hover {
  background: rgba(74, 222, 128, 0.18);
  color: rgb(187, 247, 208);
}

/* Save: indigo tint to differentiate the library action from run/mode. */
.canvas-group__action--save:hover {
  background: rgba(129, 140, 248, 0.22);
  color: rgb(199, 210, 254);
}

/* Bypass: amber when applied, matching the node-level bypass treatment. */
.canvas-group__action--bypass-on {
  background: rgba(251, 191, 36, 0.22);
  color: rgb(253, 230, 138);
}
.canvas-group__action--bypass-on:hover {
  background: rgba(251, 191, 36, 0.32);
}

/* Mute: cool gray when applied. */
.canvas-group__action--mute-on {
  background: rgba(255, 255, 255, 0.18);
  color: rgb(229, 231, 235);
}

/* Mixed: a faint outline indicates "some but not all" nodes are in this mode. */
.canvas-group__action--mixed {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.8);
}
</style>
