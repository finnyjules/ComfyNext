<script setup lang="ts">
// Floating contextual toolbar for a selected Smart Layout element — built in
// isolation here (Task 3); a later task mounts and positions it above the
// selection on the grid canvas. Mirrors CompositorInlineToolbar's control
// markup/emit patterns, and GridPropertyPanel's text section for the controls
// themselves, but each control emits a single `style` patch instead of
// mutating context directly.
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

const props = defineProps<{ element: any; bound: string | null }>()
const emit = defineEmits<{
  style: [patch: Record<string, any>]
  promote: []
  remove: []
}>()

const s = () => props.element?.style ?? {}
</script>

<template>
  <div class="flex items-center gap-1 rounded-md border border-white/10 bg-[#1b1b1f] px-1.5 py-1 shadow-lg text-xs">
    <template v-if="element?.type === 'text'">
      <input
        type="number"
        min="1"
        class="w-12 bg-white/5 rounded px-1 py-0.5"
        :value="s().fontSize"
        @change="(e: any) => emit('style', { fontSize: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined })"
      />
      <select
        class="bg-white/5 rounded px-1 py-0.5"
        :value="s().fontWeight ?? 400"
        @change="(e: any) => emit('style', { fontWeight: Number(e.target.value) })"
      >
        <option :value="400">Regular</option>
        <option :value="700">Bold</option>
      </select>
      <div class="flex">
        <button
          v-for="a in (['left', 'center', 'right'] as const)"
          :key="a"
          class="px-1.5 py-0.5 rounded"
          :class="s().align === a ? 'bg-white/15' : 'hover:bg-white/10'"
          @click="emit('style', { align: a })"
        >{{ a.charAt(0).toUpperCase() }}</button>
      </div>
      <input
        type="color"
        class="w-6 h-6 bg-transparent"
        :value="s().color ?? '#ffffff'"
        @input="(e: any) => emit('style', { color: e.target.value })"
      />
      <span class="w-px h-4 bg-white/10 mx-0.5" />
    </template>
    <VariableGlyph :bound="bound" @promote="emit('promote')" @menu="emit('promote')" />
    <button class="px-1.5 py-0.5 rounded hover:bg-white/10" title="Delete" @click="emit('remove')">✕</button>
  </div>
</template>
