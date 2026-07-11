<script setup lang="ts">
/**
 * Align row — aligns the selected layer within its container (the canvas grid
 * for a top-level element/frame, or the parent frame for a child). Shown in the
 * element and section inspectors. Mirrors Figma's align toolbar.
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
} from 'lucide-vue-next'

import type { AlignEdge, GridEditorContext } from '~/composables/useGridEditor'

const ctx = inject<GridEditorContext>('gridEditor')!

const EDGES: Array<{ edge: AlignEdge; icon: any; title: string }> = [
  { edge: 'left', icon: AlignStartVertical, title: 'Align left' },
  { edge: 'hcenter', icon: AlignCenterVertical, title: 'Align horizontal centers' },
  { edge: 'right', icon: AlignEndVertical, title: 'Align right' },
  { edge: 'top', icon: AlignStartHorizontal, title: 'Align top' },
  { edge: 'vcenter', icon: AlignCenterHorizontal, title: 'Align vertical centers' },
  { edge: 'bottom', icon: AlignEndHorizontal, title: 'Align bottom' },
]
</script>

<template>
  <div class="flex items-center gap-0.5">
    <button
      v-for="a in EDGES"
      :key="a.edge"
      class="flex-1 h-7 rounded flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
      :title="a.title"
      @click="ctx.alignSelected(a.edge)"
    >
      <component :is="a.icon" class="size-3.5" />
    </button>
  </div>
</template>
