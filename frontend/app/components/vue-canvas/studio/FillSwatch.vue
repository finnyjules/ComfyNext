<script setup lang="ts">
// One bindable colour swatch in the Type Studio fillList editor: label + variable
// hexagon, and when bound it shows the pink column name (click = edit in table)
// instead of the editable colour picker — mirroring how bound text/select controls
// render in SpaceTypeSurface.
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

defineProps<{ label: string; color: string; bound: string | null }>()
const emit = defineEmits<{
  (e: 'update:color', v: string): void
  (e: 'promote'): void
  (e: 'menu', ev: MouseEvent): void
  (e: 'edit'): void
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <span class="group flex items-center gap-1 text-[9px] uppercase tracking-wide text-white/35">
      {{ label }}
      <VariableGlyph :bound="bound" @promote="emit('promote')" @menu="emit('menu', $event)" />
    </span>
    <button
      v-if="bound"
      type="button"
      @click="emit('edit')"
      class="flex h-7 max-w-[68px] items-center truncate rounded px-2 text-[10px]"
      style="color: var(--var-accent-text); background: rgba(244, 114, 182, 0.12)"
      :title="`${bound} — edit in table`"
    >{{ bound }}</button>
    <StudioColor v-else :model-value="color" @update:model-value="emit('update:color', $event)" />
  </div>
</template>
