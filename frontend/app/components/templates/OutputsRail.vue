<script setup lang="ts">
/**
 * Outputs rail for the grid editor: one chip per chosen deliverable (an output
 * instance of a format) with a live wireframe thumbnail, label and culled
 * count. Unlike the old format tabs, this is the *picked* set — designers add
 * the outputs they want (the same format repeatedly for variations), reorder
 * by selecting, and customise each one. "Add output" appends from the format
 * catalogue; duplicate spins a variation off the selected output.
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

const THUMB_H = 34

interface Chip {
  id: string
  key: string
  label: string
  w: number
  h: number
  thumbW: number
  isMaster: boolean
  culledCount: number
  blocks: Array<{ id: string; left: string; top: string; width: string; height: string; selected: boolean }>
}

const chips = computed<Chip[]>(() => resolvedByOutput.value.map(({ output, layout: r }) => {
  const f = r.format
  const thumbW = Math.max(20, Math.min(84, Math.round(THUMB_H * (f.w / f.h))))
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
    key: output.format,
    label: output.label ?? f.label ?? output.format,
    w: f.w, h: f.h,
    thumbW,
    isMaster: output.format === template.value.master,
    culledCount: r.elements.filter(e => e.culled).length,
    blocks,
  }
}))

// -- Add-output picker --------------------------------------------------------
// Offer the union of the template's formats and the built-in catalogue so a
// designer can pull in a size that isn't on the template yet.
const addOpen = ref(false)
const catalogue = computed<Array<{ key: string; spec: FormatSpec }>>(() => {
  const seen = new Map<string, FormatSpec>()
  for (const [k, spec] of Object.entries(template.value.formats)) seen.set(k, spec)
  for (const [k, spec] of Object.entries(FORMAT_PRESETS)) if (!seen.has(k)) seen.set(k, spec)
  return [...seen.entries()].map(([key, spec]) => ({ key, spec }))
})
/** Count how many outputs already target a format — shown so adding a 2nd reads
 *  as "making a variation". */
function countFor(key: string): number {
  return (template.value.outputs ?? []).filter(o => o.format === key).length
}
function pick(key: string) {
  // Pull a catalogue-only format onto the template before adding the output.
  if (!template.value.formats[key] && FORMAT_PRESETS[key]) {
    template.value.formats[key] = structuredClone(FORMAT_PRESETS[key])
  }
  addOutput(key)
  addOpen.value = false
}

// The popover is teleported to <body> so the rail's overflow-x-auto (which also
// clips vertically) and the topbar height don't hide it — same fix as FontPicker.
const addBtnRef = ref<HTMLButtonElement>()
const addPos = ref({ top: 0, left: 0 })

function openAdd() {
  const r = addBtnRef.value?.getBoundingClientRect()
  if (!r) return
  const width = 240
  addPos.value = {
    top: r.bottom + 6,
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
  }
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
  if (document.getElementById('outputs-add-dp')?.contains(el)) return
  addOpen.value = false
}
// Capture Escape before the host modal's window listener so it closes the
// popover instead of the whole editor.
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
function startRename(chip: Chip) {
  renamingId.value = chip.id
  renameDraft.value = chip.label
  nextTick(() => {
    const inp = document.querySelector<HTMLInputElement>('[data-output-rename]')
    inp?.focus(); inp?.select()
  })
}
function commitRename() {
  if (renamingId.value) renameOutput(renamingId.value, renameDraft.value)
  renamingId.value = null
}
</script>

<template>
  <div class="flex items-stretch gap-1.5 overflow-x-auto py-1" style="scrollbar-width: none">
    <div
      v-for="c in chips"
      :key="c.id"
      class="group relative shrink-0 flex flex-col items-center gap-1 px-2 pt-1 pb-1 rounded-md border transition-colors cursor-pointer"
      :class="currentOutputId === c.id
        ? 'border-[#96b4ff]/60 bg-[#96b4ff]/10'
        : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'"
      :title="`${c.label} · ${c.w}×${c.h}`"
      @click="selectOutput(c.id)"
    >
      <!-- Hover actions: duplicate (variation) + remove -->
      <div class="absolute -top-1 -right-1 z-10 hidden group-hover:flex items-center gap-0.5">
        <button
          class="size-4 rounded-full bg-[#1a1a1a] border border-white/15 text-white/60 hover:text-[#c9d6ff] hover:border-[#96b4ff]/50 flex items-center justify-center cursor-pointer"
          title="Duplicate as a variation"
          @click.stop="duplicateOutput(c.id)"
        >
          <Copy class="size-2.5" />
        </button>
        <button
          v-if="chips.length > 1"
          class="size-4 rounded-full bg-[#1a1a1a] border border-white/15 text-white/60 hover:text-red-400 hover:border-red-500/50 flex items-center justify-center cursor-pointer"
          title="Remove this output"
          @click.stop="removeOutput(c.id)"
        >
          <X class="size-2.5" />
        </button>
      </div>

      <div class="relative bg-black/60 border border-white/10 rounded-[2px]" :style="{ width: c.thumbW + 'px', height: THUMB_H + 'px' }">
        <div
          v-for="b in c.blocks"
          :key="b.id"
          class="absolute rounded-[1px]"
          :class="b.selected ? 'bg-[#96b4ff]/80' : 'bg-white/25'"
          :style="{ left: b.left, top: b.top, width: b.width, height: b.height }"
        />
        <span
          v-if="c.culledCount"
          class="absolute -top-1.5 -left-1.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-amber-500/90 text-black text-[9px] font-medium flex items-center justify-center leading-none"
          :title="`${c.culledCount} element(s) culled in this output`"
        >–{{ c.culledCount }}</span>
      </div>

      <input
        v-if="renamingId === c.id"
        v-model="renameDraft"
        data-output-rename
        class="w-[72px] h-4 px-1 bg-black/60 border border-[#96b4ff]/50 rounded text-[9px] text-white text-center focus:outline-none"
        @click.stop
        @keydown.enter="commitRename"
        @keydown.esc="renamingId = null"
        @blur="commitRename"
      >
      <span
        v-else
        class="text-[9px] leading-none max-w-[80px] truncate"
        :class="currentOutputId === c.id ? 'text-[#c9d6ff]' : 'text-white/45'"
        title="Double-click to rename"
        @dblclick.stop="startRename(c)"
      >
        {{ c.label }}<span v-if="c.isMaster" class="text-[#96b4ff]"> ·M</span>
      </span>
    </div>

    <!-- Add output -->
    <div class="shrink-0 self-stretch flex">
      <button
        ref="addBtnRef"
        class="my-auto h-[52px] w-9 rounded-md border border-dashed flex items-center justify-center transition-colors cursor-pointer"
        :class="addOpen ? 'border-[#96b4ff]/60 bg-[#96b4ff]/10 text-[#c9d6ff]' : 'border-white/15 text-white/40 hover:text-white hover:border-white/30 hover:bg-white/[0.03]'"
        title="Add an output format"
        @click="toggleAdd"
      >
        <Plus class="size-4" />
      </button>
    </div>

    <!-- Teleported to body: the rail's overflow + the topbar would clip it. -->
    <Teleport to="body">
      <div
        v-if="addOpen"
        id="outputs-add-dp"
        class="fixed z-[9999] w-60 max-h-80 overflow-y-auto rounded-lg bg-[#161616] border border-white/10 shadow-[0_12px_48px_rgba(0,0,0,0.7)] p-1.5"
        :style="{ top: `${addPos.top}px`, left: `${addPos.left}px` }"
      >
        <p class="px-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35">Add output</p>
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
          <span v-if="countFor(f.key)" class="shrink-0 text-[9px] text-[#96b4ff]/80">+ variation</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
