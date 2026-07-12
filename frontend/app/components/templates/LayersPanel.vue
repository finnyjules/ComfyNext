<script setup lang="ts">
/**
 * Layers panel — ONE unified z-ordered tree (front at the top, Figma
 * convention). Ungrouped elements and frames (sections) interleave by the
 * template's single layer order; each frame nests its children. Any top-level
 * layer — element or whole frame — reorders via ↑/↓ or drag.
 *
 * Shared with the v1 editor, which has no sections and no unified order: there
 * it falls back to the flat element list + moveElement.
 */
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Frame,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Square,
  Type as TypeIcon,
  Unlock,
} from 'lucide-vue-next'

import { effectiveOrder, topLayer } from '~~/shared/template-grid/sections'

const ctx = inject<ReturnType<typeof useTemplateEditor>>('templateEditor')!
const { template, selectedId, moveElement, moveElementTo } = ctx

// The grid editor exposes unified-order ops + sections; the v1 editor doesn't.
const gctx = ctx as any
const isGrid = computed(() => typeof gctx.moveLayer === 'function')
const selectedSectionId = gctx.selectedSectionId as { value: string | null } | undefined

interface LayerControls {
  toggleHidden: (id: string) => void
  toggleLocked: (id: string) => void
  isHidden: (id: string) => boolean
  isLocked: (id: string) => boolean
}
const layerControls = inject<LayerControls | null>('layerControls', null)

const ICON_BY_TYPE = { text: TypeIcon, image: ImageIcon, shape: Square } as const

type LayerRow =
  | { id: string; kind: 'element'; el: any }
  | { id: string; kind: 'section'; section: any }

// Unified top-level layers, back → front.
const layers = computed<LayerRow[]>(() => {
  if (!isGrid.value) return template.value.elements.map(el => ({ id: el.id, kind: 'element' as const, el }))
  const t = template.value as any
  const rows: LayerRow[] = []
  for (const id of effectiveOrder(t)) {
    const layer = topLayer(t, id)
    if (!layer) continue
    rows.push(layer.kind === 'element'
      ? { id, kind: 'element', el: layer.el }
      : { id, kind: 'section', section: layer.section })
  }
  return rows
})
// Front at top of the panel.
const displayRows = computed(() => [...layers.value].reverse())
const lastIndex = computed(() => layers.value.length - 1)
function orderIndex(id: string) { return layers.value.findIndex(l => l.id === id) }
function isFrontmost(id: string) { return orderIndex(id) === lastIndex.value }
function isBackmost(id: string) { return orderIndex(id) === 0 }

function selectElement(id: string) {
  if (selectedSectionId) selectedSectionId.value = null
  selectedId.value = id
}
function selectSection(id: string) {
  selectedId.value = null
  if (selectedSectionId) selectedSectionId.value = id
}

function reorderUp(id: string) { if (isGrid.value) gctx.moveLayer(id, 'up'); else moveElement(id, 'up') }
function reorderDown(id: string) { if (isGrid.value) gctx.moveLayer(id, 'down'); else moveElement(id, 'down') }
function reorderTo(id: string, index: number) { if (isGrid.value) gctx.moveLayerTo(id, index); else moveElementTo(id, index) }

// Collapse a frame's children.
const collapsed = ref<Set<string>>(new Set())
function toggleCollapse(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

// Rename any layer (double-click its name).
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renamingKind = ref<'element' | 'section'>('element')
function startRename(id: string, name: string, kind: 'element' | 'section') {
  renamingId.value = id
  renameDraft.value = name
  renamingKind.value = kind
  nextTick(() => {
    const node = document.querySelector<HTMLInputElement>('[data-layer-rename]')
    node?.focus(); node?.select()
  })
}
function commitRename() {
  if (renamingId.value && isGrid.value) {
    if (renamingKind.value === 'section') gctx.renameSection(renamingId.value, renameDraft.value)
    else gctx.renameElement(renamingId.value, renameDraft.value)
  }
  renamingId.value = null
}

// Drag: reorder top-level layers, and reparent elements into / out of frames.
// `dragging.parent` is the frame id when dragging a child, else null.
const dragging = ref<{ id: string; parent: string | null } | null>(null)
const dropTargetId = ref<string | null>(null)
function onDragStart(e: DragEvent, id: string, parent: string | null) {
  dragging.value = { id, parent }
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }
}
function onDragOver(e: DragEvent, id: string) {
  if (!dragging.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetId.value = id
}
function onDragLeave(id: string) { if (dropTargetId.value === id) dropTargetId.value = null }
function reparentInto(d: { id: string; parent: string | null }, frameId: string) {
  if (d.parent === frameId) return
  if (d.parent) gctx.moveChildOutOfStack(d.parent, d.id)   // out of its current frame first
  gctx.moveChildIntoStack(frameId, d.id)
}
function onDrop(e: DragEvent, targetId: string, targetKind: 'element' | 'section') {
  e.preventDefault()
  const d = dragging.value
  dragging.value = null
  dropTargetId.value = null
  if (!d || d.id === targetId) return
  if (!isGrid.value) { reorderTo(d.id, orderIndex(targetId)); return }
  if (targetKind === 'section') {
    // Only elements reparent into frames (frame-into-frame nesting is out of scope).
    if (d.parent !== targetId) reparentInto(d, targetId)
  } else if (d.parent) {
    // A child dropped onto a top-level element → move it out to the top level.
    gctx.moveChildOutOfStack(d.parent, d.id)
  } else {
    reorderTo(d.id, orderIndex(targetId))
  }
}
function onDragEnd() { dragging.value = null; dropTargetId.value = null }
</script>

<template>
  <div class="flex flex-col">
    <div class="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
      <div class="panel-heading">Layers</div>
      <span class="text-[10px] text-white/30">{{ layers.length }}</span>
    </div>

    <div v-if="layers.length === 0" class="px-4 py-8 text-center text-[12px] text-white/40">
      No layers yet — use the Text / Image / Shape / Section buttons in the top bar.
    </div>

    <div v-else class="flex flex-col">
      <template v-for="row in displayRows" :key="row.id">
        <!-- Element row -->
        <div
          v-if="row.kind === 'element'"
          class="group relative flex items-center gap-1.5 pl-2 pr-2 py-2 text-left transition-colors border-b border-white/[0.04]"
          :class="[
            selectedId === row.id ? 'bg-action/10 text-white' : 'hover:bg-white/[0.04] text-white/65 hover:text-white/90',
            dragging?.id === row.id ? 'opacity-40' : '',
            dropTargetId === row.id && dragging?.id && dragging?.id !== row.id ? 'outline outline-1 outline-action/60 -outline-offset-1' : '',
          ]"
          :draggable="true"
          @dragstart="onDragStart($event, row.id, null)"
          @dragover="onDragOver($event, row.id)"
          @dragleave="onDragLeave(row.id)"
          @drop="onDrop($event, row.id, 'element')"
          @dragend="onDragEnd"
        >
          <GripVertical class="size-3 shrink-0 text-white/25 group-hover:text-white/50 transition-colors cursor-grab active:cursor-grabbing" />
          <input
            v-if="renamingId === row.id"
            v-model="renameDraft"
            data-layer-rename
            class="flex-1 min-w-0 h-6 px-1.5 bg-white/[0.06] border border-white/20 rounded text-[12px] text-white focus:outline-none"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.escape.prevent="renamingId = null"
            @blur="commitRename"
          >
          <button
            v-else
            class="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            :class="layerControls?.isHidden(row.id) ? 'opacity-40' : ''"
            @click="selectElement(row.id)"
            @dblclick.stop="startRename(row.id, row.el.name || row.id, 'element')"
          >
            <component :is="ICON_BY_TYPE[row.el.type]" class="size-3.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="text-[12px] truncate">{{ row.el.name || row.id }}</div>
              <div v-if="row.el.role" class="text-[10px] text-white/35 uppercase tracking-wider">{{ row.el.role }}</div>
            </div>
          </button>
          <template v-if="layerControls">
            <button
              class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition cursor-pointer shrink-0"
              :class="layerControls.isHidden(row.id) ? 'opacity-100 text-white/70' : 'opacity-0 group-hover:opacity-100 text-white/45'"
              :title="layerControls.isHidden(row.id) ? 'Show layer' : 'Hide layer'"
              @click.stop="layerControls.toggleHidden(row.id)"
            >
              <component :is="layerControls.isHidden(row.id) ? EyeOff : Eye" class="size-3" />
            </button>
            <button
              class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition cursor-pointer shrink-0"
              :class="layerControls.isLocked(row.id) ? 'opacity-100 text-white/70' : 'opacity-0 group-hover:opacity-100 text-white/45'"
              :title="layerControls.isLocked(row.id) ? 'Unlock layer' : 'Lock layer (blocks canvas edits)'"
              @click.stop="layerControls.toggleLocked(row.id)"
            >
              <component :is="layerControls.isLocked(row.id) ? Lock : Unlock" class="size-3" />
            </button>
          </template>
          <div class="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Bring forward" :disabled="isFrontmost(row.id)" @click.stop="reorderUp(row.id)"
            ><ChevronUp class="size-3 text-white/65" /></button>
            <button
              class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Send backward" :disabled="isBackmost(row.id)" @click.stop="reorderDown(row.id)"
            ><ChevronDown class="size-3 text-white/65" /></button>
          </div>
        </div>

        <!-- Frame (section) row + nested children -->
        <template v-else>
          <div
            class="group relative flex items-center gap-1 pl-1.5 pr-2 py-2 text-left transition-colors border-b border-white/[0.04]"
            :class="[
              selectedSectionId?.value === row.id ? 'bg-[#34D399]/10 text-white' : 'hover:bg-white/[0.04] text-white/70',
              dragging?.id === row.id ? 'opacity-40' : '',
              dropTargetId === row.id && dragging?.id && dragging?.id !== row.id ? 'outline outline-1 outline-[#34D399]/60 -outline-offset-1' : '',
            ]"
            :draggable="renamingId !== row.id"
            @dragstart="onDragStart($event, row.id, null)"
            @dragover="onDragOver($event, row.id)"
            @dragleave="onDragLeave(row.id)"
            @drop="onDrop($event, row.id, 'section')"
            @dragend="onDragEnd"
          >
            <GripVertical class="size-3 shrink-0 text-white/25 group-hover:text-white/50 transition-colors cursor-grab active:cursor-grabbing" />
            <button
              class="size-4 shrink-0 flex items-center justify-center text-white/40 hover:text-white cursor-pointer"
              :title="collapsed.has(row.id) ? 'Expand' : 'Collapse'"
              @click.stop="toggleCollapse(row.id)"
            >
              <component :is="collapsed.has(row.id) ? ChevronRight : ChevronDown" class="size-3" />
            </button>
            <input
              v-if="renamingId === row.id"
              v-model="renameDraft"
              data-layer-rename
              class="flex-1 min-w-0 h-6 px-1.5 bg-white/[0.06] border border-white/20 rounded text-[12px] text-white focus:outline-none"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.escape.prevent="renamingId = null"
              @blur="commitRename"
            >
            <button
              v-else
              class="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
              @click="selectSection(row.id)"
              @dblclick.stop="startRename(row.id, row.section.name, 'section')"
            >
              <Frame class="size-3.5 shrink-0 text-white/50" />
              <span class="text-[12px] truncate flex-1 min-w-0">{{ row.section.name }}</span>
              <span class="text-[10px] text-white/30 shrink-0">{{ row.section.children.length }}</span>
            </button>
            <div class="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Bring forward" :disabled="isFrontmost(row.id)" @click.stop="reorderUp(row.id)"
              ><ChevronUp class="size-3 text-white/65" /></button>
              <button
                class="size-5 rounded hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send backward" :disabled="isBackmost(row.id)" @click.stop="reorderDown(row.id)"
              ><ChevronDown class="size-3 text-white/65" /></button>
            </div>
          </div>
          <div
            v-for="child in (collapsed.has(row.id) ? [] : [...row.section.children].reverse())"
            :key="child.id"
            class="flex items-center gap-2 pl-9 pr-2 py-1.5 text-left border-b border-white/[0.04] transition-colors cursor-pointer w-full"
            :class="[
              selectedId === child.id ? 'bg-action/10 text-white' : 'hover:bg-white/[0.04] text-white/55 hover:text-white/85',
              dragging?.id === child.id ? 'opacity-40' : '',
            ]"
            :draggable="true"
            title="Drag onto a top-level layer to move it out of this frame"
            @click="selectElement(child.id)"
            @dblclick.stop="startRename(child.id, child.name || child.id, 'element')"
            @dragstart="onDragStart($event, child.id, row.id)"
            @dragend="onDragEnd"
          >
            <component :is="ICON_BY_TYPE[child.type]" class="size-3 shrink-0" />
            <input
              v-if="renamingId === child.id"
              v-model="renameDraft"
              data-layer-rename
              class="flex-1 min-w-0 h-5 px-1 bg-white/[0.06] border border-white/20 rounded text-[11px] text-white focus:outline-none"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.escape.prevent="renamingId = null"
              @blur="commitRename"
            >
            <span v-else class="text-[11px] truncate flex-1 min-w-0">{{ child.name || child.id }}</span>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
