<script setup lang="ts">
// Floating contextual toolbar for a selected Smart Layout element — built in
// isolation here (Task 3); a later task mounts and positions it above the
// selection on the grid canvas. Mirrors CompositorInlineToolbar's control
// markup/emit patterns, and GridPropertyPanel's text section for the controls
// themselves, but each control emits a single `style` patch instead of
// mutating context directly.
import { AlignCenter, AlignLeft, AlignRight, Trash2 } from 'lucide-vue-next'

import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const

const props = defineProps<{ element: any; bound: string | null }>()
const emit = defineEmits<{
  style: [patch: Record<string, any>]
  promote: []
  remove: []
}>()

const s = () => props.element?.style ?? {}
</script>

<template>
  <div data-toolbar class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1b1b1f] px-2 py-1.5 shadow-xl text-[13px]">
    <template v-if="element?.type === 'text'">
      <input
        type="number"
        min="1"
        title="Font size"
        class="w-14 h-7 bg-white/5 rounded px-2 text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-white/20"
        :value="s().fontSize"
        @change="(e: any) => emit('style', { fontSize: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })"
      />
      <select
        class="h-7 bg-white/5 rounded px-2 text-white focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer"
        :value="s().fontWeight ?? 400"
        @change="(e: any) => emit('style', { fontWeight: Number(e.target.value) })"
      >
        <option :value="400">Regular</option>
        <option :value="700">Bold</option>
      </select>
      <div class="flex items-center gap-0.5">
        <button
          v-for="a in (['left', 'center', 'right'] as const)"
          :key="a"
          class="size-7 rounded flex items-center justify-center transition-colors cursor-pointer"
          :class="s().align === a ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'"
          :title="`Align ${a}`"
          @click="emit('style', { align: a })"
        >
          <component :is="ALIGN_ICONS[a]" class="size-4" />
        </button>
      </div>
      <input
        type="color"
        title="Text colour"
        class="size-7 shrink-0 rounded border border-white/10 bg-transparent cursor-pointer"
        :value="s().color ?? '#ffffff'"
        @input="(e: any) => emit('style', { color: e.target.value })"
      />
      <span class="w-px h-5 bg-white/10 mx-0.5" />
    </template>
    <VariableGlyph :bound="bound" @promote="emit('promote')" @menu="emit('promote')" />
    <button
      class="size-7 rounded flex items-center justify-center text-white/60 transition-colors hover:bg-red-500/15 hover:text-red-300 cursor-pointer"
      title="Delete"
      @click="emit('remove')"
    >
      <Trash2 class="size-4" />
    </button>
  </div>
</template>
