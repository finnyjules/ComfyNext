<script setup lang="ts">
/**
 * Designer-friendly body for the SmartLayout node on the canvas. Replaces the
 * raw `layout` JSON / `aspects` CSV / `brand` key=value widgets with a single
 * hero "Design layout" button plus a one-line summary. Output formats are now
 * chosen *inside* the editor (the Outputs rail), not on the node face — the
 * node just opens the editor and shows what's designed.
 */
import { LayoutTemplate } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{ data: any }>()
const emit = defineEmits<{ edit: [] }>()

function widgetIdx(name: string): number {
  return (props.data.widgetDefs as any[] | undefined)?.findIndex(d => d.name === name) ?? -1
}

/** Parsed layout JSON (or null) — source of the element + output counts. */
const layout = computed<any | null>(() => {
  const i = widgetIdx('layout')
  const raw = i >= 0 ? String(props.data.widgetsValues?.[i] ?? '').trim() : ''
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
})

const elementCount = computed<number>(() => {
  const els = layout.value?.elements
  return Array.isArray(els) ? els.length : 0
})

/** Deliverables count: the template's explicit `outputs`, else the legacy
 *  `aspects` CSV. */
const outputCount = computed<number>(() => {
  const outs = layout.value?.outputs
  if (Array.isArray(outs) && outs.length) return outs.length
  const i = widgetIdx('aspects')
  const raw = i >= 0 ? String(props.data.widgetsValues?.[i] ?? '') : ''
  return raw.split(',').map(s => s.trim()).filter(Boolean).length
})
</script>

<template>
  <div class="px-2 pb-2 pt-1 nopan nodrag flex flex-col gap-2">
    <!-- Design / Edit layout (hero) -->
    <button
      class="flex items-center justify-center gap-1.5 w-full h-9 rounded-md bg-[#96b4ff]/15 hover:bg-[#96b4ff]/25 text-[#c9d6ff] hover:text-white text-xs transition-colors cursor-pointer border border-[#96b4ff]/20"
      @click="emit('edit')"
    >
      <LayoutTemplate class="size-3.5" />
      {{ elementCount ? 'Edit layout' : 'Design layout' }}
    </button>
    <div class="text-[10px] text-white/35 text-center leading-snug">
      <template v-if="elementCount">
        {{ elementCount }} element{{ elementCount === 1 ? '' : 's' }} · {{ outputCount }} output{{ outputCount === 1 ? '' : 's' }}
      </template>
      <template v-else>Empty — wire layers, then design the layout</template>
    </div>
  </div>
</template>
