<script setup lang="ts">
/**
 * Block Library — saved-group templates the user can drag or click onto any
 * canvas. Items are stored in localStorage via useBlockLibrary; this panel
 * just renders them and lets the user drag (drop-anywhere) or click
 * (insert-at-viewport-center) to materialize.
 */
import { Search as SearchIcon, X, Boxes, Trash2, Edit3, MoreVertical } from 'lucide-vue-next'
import { useBlockLibrary, type Block } from '~/composables/useBlockLibrary'

defineEmits<{ close: [] }>()

const { blocks, deleteBlock, renameBlock } = useBlockLibrary()

const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const visibleBlocks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return blocks.value
  return blocks.value.filter(b => b.name.toLowerCase().includes(q))
})

function clearSearch() {
  searchQuery.value = ''
  searchInputRef.value?.focus()
}

// Drag start — payload is the block ID. The canvas reads it from
// dataTransfer in its existing @drop handler.
function onCardDragStart(event: DragEvent, block: Block) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/x-comfynext-block', block.id)
  // Provide a text fallback so the drag still produces a sensible payload
  // even if a third-party drop target intercepts the event.
  event.dataTransfer.setData('text/plain', `block:${block.id}`)
  event.dataTransfer.effectAllowed = 'copy'
}

// Click → insert at viewport center. The canvas listens for the custom
// event and handles placement + ID assignment + group recreation.
function onCardClick(block: Block) {
  window.dispatchEvent(new CustomEvent('comfynext:insertBlock', {
    detail: { blockId: block.id, atViewportCenter: true },
  }))
}

// Per-card menu (rename / delete).
const menuOpenFor = ref<string | null>(null)
function toggleMenu(blockId: string, e: Event) {
  e.stopPropagation()
  menuOpenFor.value = menuOpenFor.value === blockId ? null : blockId
}
function onRename(block: Block, e: Event) {
  e.stopPropagation()
  menuOpenFor.value = null
  const next = window.prompt('Block name', block.name)
  if (next && next.trim()) renameBlock(block.id, next.trim())
}
function onDelete(block: Block, e: Event) {
  e.stopPropagation()
  menuOpenFor.value = null
  if (window.confirm(`Delete "${block.name}"? This can't be undone.`)) {
    deleteBlock(block.id)
  }
}

// Close the per-card menu when the user clicks elsewhere.
function onGlobalClick() {
  menuOpenFor.value = null
}
onMounted(() => window.addEventListener('click', onGlobalClick))
onBeforeUnmount(() => window.removeEventListener('click', onGlobalClick))

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{6})$/i.exec(hex)
  if (!m) return `rgba(255,255,255,${alpha})`
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
      <div class="flex items-center gap-2">
        <Boxes class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Blocks</span>
        <span class="text-[11px] text-white/40 ml-1">{{ blocks.length }}</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <!-- Search -->
    <div v-if="blocks.length" class="px-3 pt-3 pb-2 shrink-0">
      <div class="relative">
        <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Search blocks…"
          class="w-full bg-white/[0.04] border border-white/10 rounded pl-7 pr-7 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
          @keydown.esc="clearSearch"
        />
        <button
          v-if="searchQuery"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 rounded hover:bg-white/10 flex items-center justify-center cursor-pointer"
          @click="clearSearch"
        >
          <X class="size-3 text-white/50" />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="!blocks.length"
      class="flex-1 flex flex-col items-center justify-center px-6 text-center"
    >
      <div class="size-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center mb-3">
        <Boxes class="size-5 text-white/40" />
      </div>
      <p class="text-sm text-white/70 font-medium mb-1">No blocks saved yet</p>
      <p class="text-xs text-white/40 leading-relaxed">
        Group some nodes, then right-click the group and pick<br />
        <span class="text-white/60">"Save as Block…"</span> to add it here.
      </p>
    </div>

    <!-- Results -->
    <div v-else class="flex-1 overflow-y-auto px-2 pb-3 pt-1">
      <p
        v-if="searchQuery && !visibleBlocks.length"
        class="text-xs text-white/40 text-center mt-6"
      >
        No blocks match "{{ searchQuery }}".
      </p>

      <div class="flex flex-col gap-1.5">
        <div
          v-for="block in visibleBlocks"
          :key="block.id"
          class="block-card group relative flex items-stretch gap-2 px-2 py-2 rounded-md bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/10 transition-colors cursor-grab active:cursor-grabbing"
          draggable="true"
          @dragstart="onCardDragStart($event, block)"
          @click="onCardClick(block)"
        >
          <!-- Name + meta. Color is intentionally not surfaced here — it's
               mostly auto-assigned and shows up plenty on the canvas. -->
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <span class="text-[12px] font-medium text-white/90 truncate">{{ block.name }}</span>
            <div class="text-[10px] text-white/40 flex items-center gap-1.5">
              <span>{{ block.nodes.length }} node{{ block.nodes.length === 1 ? '' : 's' }}</span>
              <span>·</span>
              <span>{{ relativeTime(block.createdAt) }}</span>
            </div>
          </div>
          <!-- Menu trigger -->
          <button
            class="shrink-0 self-start flex items-center justify-center size-5 rounded text-white/40 hover:text-white/90 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            :aria-label="`Block ${block.name} actions`"
            @click="toggleMenu(block.id, $event)"
          >
            <MoreVertical class="size-3.5" />
          </button>
          <!-- Inline menu -->
          <div
            v-if="menuOpenFor === block.id"
            class="absolute right-2 top-9 z-10 min-w-[140px] py-1 bg-[#1f1f1f] border border-white/10 rounded-md shadow-2xl text-[12px]"
          >
            <button
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-white/85 hover:bg-white/8 cursor-pointer"
              @click="onRename(block, $event)"
            >
              <Edit3 class="size-3 text-white/60" />
              <span>Rename</span>
            </button>
            <button
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-300 hover:bg-rose-500/15 cursor-pointer"
              @click="onDelete(block, $event)"
            >
              <Trash2 class="size-3" />
              <span>Delete</span>
            </button>
          </div>

          <!-- Bottom-left subtle hint on hover -->
          <div
            class="pointer-events-none absolute inset-x-2 bottom-1 text-[9px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between"
          >
            <span>Drag to canvas · click to insert</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block-card {
  /* Reserve space for the hover hint so the layout doesn't reflow on hover. */
  padding-bottom: 22px;
}
</style>
