<script setup lang="ts">
/**
 * Designer-friendly body for the SmartLayout node on the canvas. Replaces the
 * raw `layout` JSON textarea, `aspects` CSV and `brand` key=value widgets with:
 *  - a row of format chips (real names; click to include/exclude an output size)
 *  - an Edit-layout button (opens the visual editor)
 *  - a one-line summary of what's designed
 *
 * Reads/writes the node's widget values directly (same contract as the generic
 * widget loop): the chips drive the `aspects` widget; the layout JSON is never
 * shown — it's authored in the editor modal.
 */
import { LayoutTemplate } from 'lucide-vue-next'
import { computed } from 'vue'

import { FORMAT_PRESETS } from '~~/shared/template-grid/starter'

const props = defineProps<{ data: any }>()
const emit = defineEmits<{ edit: [] }>()

function widgetIdx(name: string): number {
  return (props.data.widgetDefs as any[] | undefined)?.findIndex(d => d.name === name) ?? -1
}

/** Parsed layout JSON (or null) — source of the format set + element count. */
const layout = computed<any | null>(() => {
  const i = widgetIdx('layout')
  const raw = i >= 0 ? String(props.data.widgetsValues?.[i] ?? '').trim() : ''
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
})

/** Format key → label, from the template if present, else the built-in presets. */
const formats = computed<Record<string, { label?: string; w?: number; h?: number }>>(() => {
  const f = layout.value?.formats
  return f && typeof f === 'object' && Object.keys(f).length ? f : FORMAT_PRESETS
})

const aspectsIdx = computed(() => widgetIdx('aspects'))
const selected = computed<Set<string>>(() => {
  const i = aspectsIdx.value
  const raw = i >= 0 ? String(props.data.widgetsValues?.[i] ?? '') : ''
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean))
})

interface Chip { key: string; label: string; on: boolean }
const chips = computed<Chip[]>(() => {
  const out: Chip[] = []
  const seen = new Set<string>()
  for (const [key, spec] of Object.entries(formats.value)) {
    out.push({ key, label: spec.label ?? key, on: selected.value.has(key) })
    seen.add(key)
  }
  // Keep any selected key that isn't a known format (don't silently drop it).
  for (const key of selected.value) {
    if (!seen.has(key)) out.push({ key, label: key, on: true })
  }
  return out
})

function toggle(key: string) {
  const i = aspectsIdx.value
  if (i < 0) return
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  // Preserve the formats' natural order in the CSV for stable output naming.
  const ordered = [
    ...Object.keys(formats.value).filter(k => next.has(k)),
    ...[...next].filter(k => !(k in formats.value)),
  ]
  props.data.widgetsValues[i] = ordered.join(',')
}

const elementCount = computed<number>(() => {
  const els = layout.value?.elements
  return Array.isArray(els) ? els.length : 0
})
const selectedCount = computed(() => selected.value.size)
</script>

<template>
  <div class="px-2 pb-2 pt-1 nopan nodrag flex flex-col gap-2">
    <!-- Output formats -->
    <div>
      <div class="text-[9px] uppercase tracking-[0.14em] text-white/35 mb-1 px-0.5">Output formats</div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="c in chips"
          :key="c.key"
          class="px-2 h-6 rounded-md text-[11px] transition-colors cursor-pointer border"
          :class="c.on
            ? 'bg-[#96b4ff]/20 text-[#c9d6ff] border-[#96b4ff]/30'
            : 'bg-white/[0.03] text-white/45 border-transparent hover:bg-white/[0.06] hover:text-white/70'"
          :title="c.on ? `${c.label} — included` : `${c.label} — click to include`"
          @click="toggle(c.key)"
        >
          {{ c.label }}
        </button>
      </div>
    </div>

    <!-- Edit layout (hero) + summary -->
    <button
      class="flex items-center justify-center gap-1.5 w-full h-8 rounded-md bg-[#96b4ff]/15 hover:bg-[#96b4ff]/25 text-[#c9d6ff] hover:text-white text-xs transition-colors cursor-pointer border border-[#96b4ff]/20"
      @click="emit('edit')"
    >
      <LayoutTemplate class="size-3.5" />
      {{ elementCount ? 'Edit layout' : 'Design layout' }}
    </button>
    <div class="text-[10px] text-white/35 text-center leading-snug">
      <template v-if="elementCount">{{ elementCount }} element{{ elementCount === 1 ? '' : 's' }} · {{ selectedCount }} format{{ selectedCount === 1 ? '' : 's' }}</template>
      <template v-else>Empty — wire layers, then design the layout</template>
    </div>
  </div>
</template>
