<script setup lang="ts">
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID } from '~/data/kinetic-presets'
import type { LayerAnimation, LayerAnimSpec } from '~/lib/motion/types'

const props = defineProps<{ animation: LayerAnimation | undefined }>()
const emit = defineEmits<{ update: [anim: LayerAnimation | undefined] }>()

// Some supported ids ('float', 'glitch-in', …) may be absent from the catalog;
// fall back to the raw id.
const label = (id: string) => KINETIC_PRESETS_BY_ID[id]?.label ?? id

function patch(p: Partial<LayerAnimation>) {
  emit('update', { offset: 0, ...(props.animation ?? {}), ...p })
}
function patchSpec(key: 'in' | 'out' | 'loop', presetId: string) {
  if (!presetId) return patch({ [key]: undefined })
  const cur: LayerAnimSpec = props.animation?.[key] ?? { presetId, duration: key === 'loop' ? 1.5 : 0.8, stagger: 0.04 }
  patch({ [key]: { ...cur, presetId } })
}
function patchSpecNum(key: 'in' | 'out' | 'loop', field: 'duration' | 'stagger', v: number) {
  const cur = props.animation?.[key]
  if (!cur) return
  patch({ [key]: { ...cur, [field]: v } })
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div class="flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-[0.12em] text-white/40">Animation</span>
      <button v-if="animation" class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90 cursor-pointer" @click="emit('update', undefined)">Clear</button>
    </div>
    <label class="flex items-center justify-between gap-2 text-white/60">Start (s)
      <input
        type="number" min="0" step="0.1" :value="animation?.offset ?? 0"
        class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="patch({ offset: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
      >
    </label>
    <label class="flex items-center justify-between gap-2 text-white/60">Duration (s)
      <input
        type="number" min="0.1" step="0.1" :value="animation?.duration ?? ''" placeholder="to end"
        class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="(e: Event) => { const v = (e.target as HTMLInputElement).value; patch({ duration: v === '' ? undefined : Math.max(0.1, Number(v)) }) }"
      >
    </label>
    <div v-for="key in (['in', 'out', 'loop'] as const)" :key="key" class="space-y-1">
      <label class="flex items-center justify-between gap-2 capitalize text-white/60">{{ key }}
        <select
          class="w-32 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none cursor-pointer"
          :value="animation?.[key]?.presetId ?? ''"
          @change="patchSpec(key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">none</option>
          <option
            v-for="id in (key === 'in' ? SUPPORTED_IN_IDS : key === 'out' ? SUPPORTED_OUT_IDS : SUPPORTED_LOOP_IDS)"
            :key="id" :value="id"
          >{{ label(id) }}</option>
        </select>
      </label>
      <div v-if="animation?.[key]" class="flex gap-2 pl-2 text-white/60">
        <label class="flex items-center gap-1">dur
          <input
            type="number" min="0.1" step="0.1" :value="animation[key]!.duration"
            class="w-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
            @change="patchSpecNum(key, 'duration', Math.max(0.1, Number(($event.target as HTMLInputElement).value) || 0.8))"
          >
        </label>
        <label class="flex items-center gap-1">stagger
          <input
            type="number" min="0" step="0.01" :value="animation[key]!.stagger ?? 0.04"
            class="w-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
            @change="patchSpecNum(key, 'stagger', Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))"
          >
        </label>
      </div>
    </div>
  </div>
</template>
