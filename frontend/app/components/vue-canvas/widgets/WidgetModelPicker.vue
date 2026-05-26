<script setup lang="ts">
/**
 * WidgetModelPicker — node-body launcher button that opens the
 * ModelGalleryModal. Replaces the standard Combo dropdown for inputs the
 * backend marks with `extra_dict={"comfynext_widget": "model_picker"}`.
 *
 * Reads the catalog so the button can show the model's brand swatch and
 * pretty label instead of the raw id. Falls back to the id when the model
 * isn't in the catalog (lets old workflows with unknown ids still render
 * without crashing).
 */
import { ChevronRight } from 'lucide-vue-next'
import { IMAGE_MODELS_BY_ID } from '~/data/image-models'

const props = defineProps<{
  modelValue: string                    // selected model id
  nodeId?: string                       // forwarded to the open event
}>()

// The widget framework still expects update:modelValue even though we don't
// emit it directly (the modal writes to widgetsValues via the node ref).
// Declared for type-safety and future use.
defineEmits<{ 'update:modelValue': [value: string] }>()

const model = computed(() => IMAGE_MODELS_BY_ID[props.modelValue] ?? null)

const BRAND_COLORS: Record<string, string> = {
  'BFL':          '#ff6b8b',
  'Google':       '#4796ff',
  'OpenAI':       '#10a37f',
  'ByteDance':    '#26a6ff',
  'Ideogram':     '#a86bff',
  'Recraft':      '#ffb84d',
  'Stability AI': '#ff8a4d',
  'Alibaba':      '#ff7a3d',
  'Tencent':      '#48a8ff',
  'xAI':          '#cccccc',
  'Pruna':        '#9b6bff',
  'Meta':         '#3d7aff',
  'Other':        '#888',
}

function openGallery() {
  window.dispatchEvent(new CustomEvent('comfynext:openModelGallery', {
    detail: { nodeId: props.nodeId },
  }))
}
</script>

<template>
  <button
    class="nopan nodrag w-full flex items-center gap-2 px-2 py-1.5 rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-colors cursor-pointer text-left group"
    :title="model
      ? `${model.label} — click to change model`
      : `Pick a model (current: ${modelValue || '—'})`"
    @click="openGallery"
  >
    <!-- Brand swatch (filled circle in the brand's signature hue) -->
    <span
      class="size-5 rounded-md shrink-0 flex items-center justify-center text-[9px] font-bold leading-none text-black/80"
      :style="model
        ? { backgroundColor: BRAND_COLORS[model.brand] ?? '#888' }
        : { backgroundColor: '#444' }"
    >
      {{ model ? (model.brand[0] ?? '?') : '?' }}
    </span>
    <!-- Label stack -->
    <span class="flex flex-col min-w-0 flex-1">
      <span class="text-[11px] font-medium text-white/90 truncate leading-tight">
        {{ model?.label ?? modelValue ?? 'Pick a model' }}
      </span>
      <span v-if="model" class="text-[9px] text-white/40 truncate uppercase tracking-[0.06em] leading-tight">
        {{ model.brand }}
      </span>
    </span>
    <ChevronRight class="size-3.5 text-white/30 group-hover:text-white/55 shrink-0 transition-colors" />
  </button>
</template>
