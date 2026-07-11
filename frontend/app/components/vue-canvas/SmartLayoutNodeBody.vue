<script setup lang="ts">
/**
 * Designer-friendly body for the SmartLayout node on the canvas. Replaces the
 * raw `layout` JSON / `aspects` CSV / `brand` key=value widgets with a single
 * hero "Design layout" button plus a one-line summary. Output formats are now
 * chosen *inside* the editor (the Outputs rail), not on the node face — the
 * node just opens the editor and shows what's designed.
 */
import { LayoutTemplate } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { VAR_PREVIEW_PROP, BINDINGS_PROP } from '~/lib/collection/types'
import { readTemplateFromNode } from '~/lib/collection/bindables'

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

// --- Collection-driven live preview ---------------------------------------
// When a Collection is wired into this node's `vars` input with bindings set,
// CollectionDrawer/CollectionNode stamp the resolved row onto
// data.properties.sailor_varPreview. We watch that and render a rendered
// thumbnail (via the same /api/render-template pipeline the layout editor
// uses) so scrubbing rows updates the node face live.
const previewUrl = ref<string | null>(null)
let debounceHandle: ReturnType<typeof setTimeout> | null = null
// Module-instance generation counter: guards against an older in-flight
// /api/render-template response resolving after a newer one and clobbering
// the preview with stale (backwards-flickering) content.
let renderGeneration = 0

const varCount = computed(() => Object.keys(props.data.properties?.[BINDINGS_PROP] ?? {}).length)

async function renderVarPreview() {
  const preview = props.data.properties?.[VAR_PREVIEW_PROP]
  const template = readTemplateFromNode({ data: props.data }) as any
  if (!preview || !template) return
  const generation = ++renderGeneration
  try {
    const res = await fetch('/api/render-template', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template, aspect: template.master, props: preview.props ?? {}, brand: preview.brand ?? {} }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    if (generation !== renderGeneration) return // a newer request superseded this one — drop it
    const nextUrl = URL.createObjectURL(blob)
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = nextUrl
  } catch {
    // Best-effort preview — leave the previous thumbnail (or none) on failure.
  }
}

watch(
  () => props.data.properties?.[VAR_PREVIEW_PROP],
  (preview) => {
    if (debounceHandle) clearTimeout(debounceHandle)
    if (!preview) return
    debounceHandle = setTimeout(renderVarPreview, 400)
  },
  { deep: true, immediate: true },
)

onBeforeUnmount(() => {
  if (debounceHandle) clearTimeout(debounceHandle)
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="px-2 pb-2 pt-1 nopan nodrag flex flex-col gap-2">
    <div v-if="varCount" class="flex justify-end">
      <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{{ varCount }} vars</span>
    </div>
    <img
      v-if="previewUrl"
      :src="previewUrl"
      class="w-full rounded-md border border-white/10 mb-1"
    />
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
