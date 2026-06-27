<script setup lang="ts">
/**
 * Vertical format/layout selector for the left column: one row per chosen
 * deliverable (output) with a live wireframe thumbnail, label, dimensions and
 * master tag. Select to switch the canvas; hover for duplicate / remove;
 * double-click the name to rename; "Add format" appends from the catalogue.
 * The rows counterpart of the old top OutputsRail — same composable API.
 */
import { Copy, Plus, X } from 'lucide-vue-next'

import type { GridEditorContext } from '~/composables/useGridEditor'
import { FORMAT_PRESETS } from '~~/shared/template-grid/starter'
import type { FormatSpec } from '~~/shared/template-grid/types'

const ctx = inject<GridEditorContext>('gridEditor')!
const {
  template, currentOutputId, resolvedByOutput, selectedId,
  selectOutput, addOutput, duplicateOutput, removeOutput, renameOutput,
} = ctx

const THUMB_H = 30

interface Row {
  id: string
  label: string
  w: number
  h: number
  thumbW: number
  isMaster: boolean
  culledCount: number
  blocks: Array<{ id: string; left: string; top: string; width: string; height: string; selected: boolean }>
}

const rows = computed<Row[]>(() => resolvedByOutput.value.map(({ output, layout: r }) => {
  const f = r.format
  const thumbW = Math.max(16, Math.min(48, Math.round(THUMB_H * (f.w / f.h))))
  const sx = thumbW / f.w
  const sy = THUMB_H / f.h
  const blocks = r.elements.filter(e => !e.culled).map(e => ({
    id: e.el.id,
    left: `${e.rect.x * sx}px`,
    top: `${e.rect.y * sy}px`,
    width: `${Math.max(1, e.rect.w * sx)}px`,
    height: `${Math.max(1, e.rect.h * sy)}px`,
    selected: e.el.id === selectedId.value,
  }))
  return {
    id: output.id,
    label: output.label ?? f.label ?? output.format,
    w: f.w, h: f.h,
    thumbW,
    isMaster: output.format === template.value.master,
    culledCount: r.elements.filter(e => e.culled).length,
    blocks,
  }
}))

// -- Add-format catalogue (union of template formats + presets) --------------
const addOpen = ref(false)
const catalogue = computed<Array<{ key: string; spec: FormatSpec }>>(() => {
  const seen = new Map<string, FormatSpec>()
  for (const [k, spec] of Object.entries(template.value.formats)) seen.set(k, spec)
  for (const [k, spec] of Object.entries(FORMAT_PRESETS)) if (!seen.has(k)) seen.set(k, spec)
  return [...seen.entries()].map(([key, spec]) => ({ key, spec }))
})
function countFor(key: string): number {
  return (template.value.outputs ?? []).filter(o => o.format === key).length
}
function pick(key: string) {
  if (!template.value.formats[key] && FORMAT_PRESETS[key]) {
    template.value.formats[key] = structuredClone(FORMAT_PRESETS[key])
  }
  addOutput(key)
  addOpen.value = false
}

const addBtnRef = ref<HTMLButtonElement>()
const addPos = ref({ top: 0, left: 0 })
function openAdd() {
  const r = addBtnRef.value?.getBoundingClientRect()
  if (!r) return
  const width = 240
  addPos.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) }
  addOpen.value = true
}
function toggleAdd() {
  if (addOpen.value) addOpen.value = false
  else openAdd()
}
function onAddClickOutside(e: MouseEvent) {
  if (!addOpen.value) return
  const el = e.target as Node
  if (addBtnRef.value?.contains(el)) return
  if (document.getElementById('formatlist-add-dp')?.contains(el)) return
  addOpen.value = false
}
function onAddKey(e: KeyboardEvent) {
  if (addOpen.value && e.key === 'Escape') { e.stopPropagation(); addOpen.value = false }
}
onMounted(() => {
  document.addEventListener('mousedown', onAddClickOutside, true)
  window.addEventListener('keydown', onAddKey, true)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onAddClickOutside, true)
  window.removeEventListener('keydown', onAddKey, true)
})

// -- Inline rename ------------------------------------------------------------
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
function startRename(row: Row) {
  renamingId.value = row.id
  renameDraft.value = row.label
  nextTick(() => {
    const inp = document.querySelector<HTMLInputElement>('[data-format-rename]')
    inp?.focus(); inp?.select()
  })
}
function commitRename() {
  if (renamingId.value) renameOutput(renamingId.value, renameDraft.value)
  renamingId.value = null
}
</script>

<template>
  <div class="px-2 py-2">
    <p class="px-1 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-white/35">Formats</p>

    <div class="flex flex-col gap-0.5">
      <div
        v-for="row in rows"
        :key="row.id"
        class="group relative flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
        :class="currentOutputId === row.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'"
        :title="`${row.label} · ${row.w}×${row.h}`"
        @click="selectOutput(row.id)"
      >
        <!-- wireframe thumbnail (fixed-width column so labels left-align) -->
        <div class="w-11 shrink-0 flex items-center">
          <div
            class="relative bg-black/60 border border-white/10 rounded-[2px]"
            :style="{ width: row.thumbW + 'px', height: THUMB_H + 'px' }"
          >
            <div
              v-for="b in row.blocks"
              :key="b.id"
              class="absolute rounded-[1px]"
              :class="b.selected ? 'bg-white/70' : 'bg-white/25'"
              :style="{ left: b.left, top: b.top, width: b.width, height: b.height }"
            />
          </div>
        </div>

        <!-- label + dims -->
        <div class="flex-1 min-w-0">
          <input
            v-if="renamingId === row.id"
            v-model="renameDraft"
            data-format-rename
            class="w-full h-5 px-1 bg-black/60 border border-white/30 rounded text-[12px] text-white focus:outline-none"
            @click.stop
            @keydown.enter="commitRename"
            @keydown.esc="renamingId = null"
            @blur="commitRename"
          >
          <template v-else>
            <div
              class="text-[12px] truncate leading-tight"
              :class="currentOutputId === row.id ? 'text-white' : 'text-white/80'"
              @dblclick.stop="startRename(row)"
            >
              {{ row.label }}<span v-if="row.isMaster" class="text-white/40"> · M</span>
            </div>
            <div class="text-[10px] text-white/35 tabular-nums leading-tight">{{ row.w }} × {{ row.h }}</div>
          </template>
        </div>

        <!-- culled count -->
        <span
          v-if="row.culledCount"
          class="shrink-0 min-w-4 h-4 px-1 rounded-full bg-amber-500/90 text-black text-[9px] font-medium flex items-center justify-center leading-none"
          :title="`${row.culledCount} element(s) culled in this format`"
        >–{{ row.culledCount }}</span>

        <!-- hover actions -->
        <div class="shrink-0 hidden group-hover:flex items-center gap-0.5">
          <button
            class="size-5 rounded flex items-center justify-center text-white/50 hover:text-[#c9d6ff] hover:bg-white/10 cursor-pointer"
            title="Duplicate as a variation"
            @click.stop="duplicateOutput(row.id)"
          >
            <Copy class="size-3" />
          </button>
          <button
            v-if="rows.length > 1"
            class="size-5 rounded flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-white/10 cursor-pointer"
            title="Remove this format"
            @click.stop="removeOutput(row.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- Add format -->
    <button
      ref="addBtnRef"
      class="mt-1 w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer"
      :class="addOpen ? 'bg-white/[0.07] text-white' : 'text-white/45 hover:text-white hover:bg-white/[0.04]'"
      title="Add a format"
      @click="toggleAdd"
    >
      <div class="w-11 shrink-0 flex items-center"><Plus class="size-3.5" /></div>
      <span class="text-[12px]">Add format</span>
    </button>

    <Teleport to="body">
      <div
        v-if="addOpen"
        id="formatlist-add-dp"
        class="fixed z-[9999] w-60 max-h-80 overflow-y-auto rounded-lg bg-[#161616] border border-white/10 shadow-[0_12px_48px_rgba(0,0,0,0.7)] p-1.5"
        :style="{ top: `${addPos.top}px`, left: `${addPos.left}px` }"
      >
        <p class="px-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35">Add format</p>
        <button
          v-for="f in catalogue"
          :key="f.key"
          class="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer text-left"
          @click="pick(f.key)"
        >
          <span
            class="shrink-0 bg-black/50 border border-white/10 rounded-[2px]"
            :style="{ width: Math.max(10, Math.min(28, Math.round(16 * (f.spec.w / f.spec.h)))) + 'px', height: '16px' }"
          />
          <span class="flex-1 min-w-0">
            <span class="block text-[12px] text-white/85 truncate">{{ f.spec.label ?? f.key }}</span>
            <span class="block text-[10px] text-white/35 tabular-nums">{{ f.spec.w }}×{{ f.spec.h }}</span>
          </span>
          <span v-if="countFor(f.key)" class="shrink-0 text-[9px] text-white/40">+ variation</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
