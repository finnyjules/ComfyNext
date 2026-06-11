<script setup lang="ts">
/**
 * Top-level shell for the v2 (Swiss grid) editor: format tabs, canvas,
 * reused LayersPanel, grid property panel, worst-case copy toggle, save.
 *
 * Owns the useGridEditor composable and provides it under BOTH 'gridEditor'
 * (the v2 components) and 'templateEditor' (LayersPanel reuse — it only
 * touches template/selectedId/moveElement/moveElementTo, which the grid
 * context exposes with identical contracts).
 */
import { CaseSensitive, ImagePlus, Save, Square, Type as TypeIcon } from 'lucide-vue-next'

import { useGridEditor } from '~/composables/useGridEditor'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const props = defineProps<{
  initial: TemplateV2
  initialProps?: Record<string, string>
  initialBrand?: Record<string, string>
}>()

const emit = defineEmits<{ save: [layout: TemplateV2] }>()

const ctx = useGridEditor(props.initial)
provide('gridEditor', ctx)
provide('templateEditor', ctx as any)

const { template, dirty, worstCase, selectedElement, sampleProps, sampleBrand } = ctx

if (props.initialProps && Object.keys(props.initialProps).length > 0) {
  Object.assign(sampleProps.value, props.initialProps)
}
if (props.initialBrand && Object.keys(props.initialBrand).length > 0) {
  Object.assign(sampleBrand.value, props.initialBrand)
}
watch(() => props.initialProps, (next) => {
  if (next && Object.keys(next).length > 0) Object.assign(sampleProps.value, next)
}, { deep: true })

function handleSave() {
  emit('save', JSON.parse(JSON.stringify(template.value)))
  dirty.value = false
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-[#0a0a0a]">
    <!-- Top bar. pr-12 keeps the host modal's absolute close button clear. -->
    <div class="shrink-0 h-14 pl-4 pr-12 border-b border-white/[0.06] flex items-center gap-3">
      <input
        :value="template.name"
        class="w-40 h-8 px-2 bg-transparent border border-transparent hover:border-white/[0.06] focus:border-[#96b4ff]/50 rounded text-[13px] text-white font-medium focus:outline-none"
        @change="(e: any) => { template.name = e.target.value; dirty = true }"
      >

      <div class="flex-1 min-w-0">
        <TemplatesGridFormatTabs />
      </div>

      <button
        class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer"
        :class="worstCase ? 'bg-amber-500/15 text-amber-200' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'"
        title="Preview with worst-case copy length — stress-test shrinking and truncation"
        @click="worstCase = !worstCase"
      >
        <CaseSensitive class="size-4" />
        Long copy
      </button>

      <div class="flex items-center gap-1">
        <button class="h-8 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5 text-[12px] text-white/70 transition-colors cursor-pointer" @click="ctx.addText()">
          <TypeIcon class="size-3.5" /> Text
        </button>
        <button class="h-8 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5 text-[12px] text-white/70 transition-colors cursor-pointer" @click="ctx.addImage()">
          <ImagePlus class="size-3.5" /> Image
        </button>
        <button class="h-8 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5 text-[12px] text-white/70 transition-colors cursor-pointer" @click="ctx.addShape()">
          <Square class="size-3.5" /> Shape
        </button>
      </div>

      <div class="flex items-center gap-2">
        <span v-if="dirty" class="size-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
        <button
          class="h-8 px-3 rounded-md bg-[#96b4ff]/20 hover:bg-[#96b4ff]/30 flex items-center gap-1.5 text-[12px] text-[#c9d6ff] transition-colors cursor-pointer"
          @click="handleSave"
        >
          <Save class="size-3.5" /> Save & close
        </button>
        <slot name="topbar-end" />
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 flex min-h-0">
      <div class="w-[240px] shrink-0 border-r border-white/[0.06] bg-[#0e0e10] overflow-y-auto">
        <TemplatesLayersPanel />
      </div>
      <div class="flex-1 min-w-0 relative overflow-hidden bg-[#121212]">
        <TemplatesGridEditorCanvas />
      </div>
      <div v-if="selectedElement" class="w-[300px] shrink-0 border-l border-white/[0.06] bg-[#0e0e10]">
        <TemplatesGridPropertyPanel />
      </div>
    </div>
  </div>
</template>
