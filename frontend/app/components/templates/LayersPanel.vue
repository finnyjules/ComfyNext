<script setup lang="ts">
/**
 * Right panel default state — list of elements + reorder controls.
 *
 * The array `template.elements` is z-ordered: later in the array renders on
 * top. We display it reversed in the panel so top-of-list = front (Figma /
 * Photoshop convention).
 *
 * Reorder: drag any row by its grip handle to drop it elsewhere in the list,
 * or use the ↑ / ↓ buttons (revealed on hover) for one-step moves.
 */
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Square,
  Type as TypeIcon,
  Unlock,
} from 'lucide-vue-next'

const ctx = inject<ReturnType<typeof useTemplateEditor>>('templateEditor')!
const { template, selectedId, moveElement, moveElementTo } = ctx

// Optional per-layer controls — provided only by the v2 grid editor. When
// absent (v1 editor) the eye/lock affordances simply don't render.
interface LayerControls {
  toggleHidden: (id: string) => void
  toggleLocked: (id: string) => void
  isHidden: (id: string) => boolean
  isLocked: (id: string) => boolean
}
const layerControls = inject<LayerControls | null>('layerControls', null)

const ICON_BY_TYPE = { text: TypeIcon, image: ImageIcon, shape: Square } as const

// Display top-to-bottom = front-to-back. Track each element's true array
// index alongside so move calls can translate between the two views.
const displayList = computed(() => {
  const arr = template.value.elements.map((el, idx) => ({ el, idx }))
  arr.reverse()
  return arr
})

function isFrontmost(idx: number) {
  return idx === template.value.elements.length - 1
}
function isBackmost(idx: number) {
  return idx === 0
}

// ── Drag-and-drop reorder ────────────────────────────────────────────────

const draggingIdx = ref<number | null>(null)
const dropTargetIdx = ref<number | null>(null)

function onDragStart(e: DragEvent, idx: number) {
  draggingIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Setting some data is required for FF to fire dragover.
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(e: DragEvent, idx: number) {
  if (draggingIdx.value === null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetIdx.value = idx
}

function onDragLeave(idx: number) {
  if (dropTargetIdx.value === idx) dropTargetIdx.value = null
}

function onDrop(e: DragEvent, idx: number) {
  e.preventDefault()
  if (draggingIdx.value === null || draggingIdx.value === idx) {
    draggingIdx.value = null
    dropTargetIdx.value = null
    return
  }
  const fromId = template.value.elements[draggingIdx.value]?.id
  if (fromId) moveElementTo(fromId, idx)
  draggingIdx.value = null
  dropTargetIdx.value = null
}

function onDragEnd() {
  draggingIdx.value = null
  dropTargetIdx.value = null
}
</script>

<template>
  <div class="flex flex-col">
    <div class="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
      <div class="panel-heading">Elements</div>
      <span class="text-[10px] text-white/30">{{ template.elements.length }}</span>
    </div>

    <div v-if="template.elements.length === 0" class="px-4 py-8 text-center text-[12px] text-white/40">
      No elements yet — use the Text / Image / Shape buttons in the top bar to add one.
    </div>

    <div v-else class="flex flex-col">
      <div
        v-for="{ el, idx } in displayList"
        :key="el.id"
        class="group relative flex items-center gap-1.5 pl-2 pr-2 py-2 text-left transition-colors border-b border-white/[0.04]"
        :class="[
          selectedId === el.id
            ? 'bg-[#96b4ff]/10 text-white'
            : 'hover:bg-white/[0.04] text-white/65 hover:text-white/90',
          draggingIdx === idx ? 'opacity-40' : '',
          dropTargetIdx === idx && draggingIdx !== null && draggingIdx !== idx
            ? 'outline outline-1 outline-[#96b4ff]/60 -outline-offset-1'
            : '',
        ]"
        :draggable="true"
        @dragstart="onDragStart($event, idx)"
        @dragover="onDragOver($event, idx)"
        @dragleave="onDragLeave(idx)"
        @drop="onDrop($event, idx)"
        @dragend="onDragEnd"
      >
        <!-- Grip handle — visual cue for drag -->
        <GripVertical
          class="size-3 shrink-0 text-white/25 group-hover:text-white/50 transition-colors cursor-grab active:cursor-grabbing"
        />

        <!-- Type icon + label (clickable to select) -->
        <button
          class="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
          :class="layerControls?.isHidden(el.id) ? 'opacity-40' : ''"
          @click="selectedId = el.id"
        >
          <component :is="ICON_BY_TYPE[el.type]" class="size-3.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-[12px] truncate">{{ el.id }}</div>
            <div v-if="el.role" class="text-[10px] text-white/35 uppercase tracking-wider">{{ el.role }}</div>
          </div>
        </button>

        <!-- Hide / lock toggles (grid editor only). Persist when active, else
             reveal on hover. -->
        <template v-if="layerControls">
          <button
            class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition cursor-pointer shrink-0"
            :class="layerControls.isHidden(el.id) ? 'opacity-100 text-white/70' : 'opacity-0 group-hover:opacity-100 text-white/45'"
            :title="layerControls.isHidden(el.id) ? 'Show layer' : 'Hide layer'"
            @click.stop="layerControls.toggleHidden(el.id)"
          >
            <component :is="layerControls.isHidden(el.id) ? EyeOff : Eye" class="size-3" />
          </button>
          <button
            class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition cursor-pointer shrink-0"
            :class="layerControls.isLocked(el.id) ? 'opacity-100 text-white/70' : 'opacity-0 group-hover:opacity-100 text-white/45'"
            :title="layerControls.isLocked(el.id) ? 'Unlock layer' : 'Lock layer (blocks canvas edits)'"
            @click.stop="layerControls.toggleLocked(el.id)"
          >
            <component :is="layerControls.isLocked(el.id) ? Lock : Unlock" class="size-3" />
          </button>
        </template>

        <!-- One-step reorder buttons (hover-revealed) -->
        <div class="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Bring forward"
            :disabled="isFrontmost(idx)"
            @click.stop="moveElement(el.id, 'up')"
          >
            <ChevronUp class="size-3 text-white/65" />
          </button>
          <button
            class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send backward"
            :disabled="isBackmost(idx)"
            @click.stop="moveElement(el.id, 'down')"
          >
            <ChevronDown class="size-3 text-white/65" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
