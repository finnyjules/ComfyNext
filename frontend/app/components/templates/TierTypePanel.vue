<script setup lang="ts">
import type { TierId } from '~~/shared/template-grid/types'

const ctx = inject<any>('gridEditor')

// Round-2 element ids are indexed (`tier_hero_0`, `tier_support_2`, …) —
// parse BOTH the tier name and its item index so an edit here targets
// exactly the selected item (ctx.setTierType/tierType thread `index`
// through to `items[index]` — see useGridEditor.ts).
const TIER_ID_RE = /^tier_([a-z]+)_(\d+)/
const parsed = computed<{ id: TierId; index: number } | null>(() => {
  const rawId = ctx?.selectedElement?.value?.id as string | undefined
  const m = rawId ? TIER_ID_RE.exec(rawId) : null
  return m ? { id: m[1] as TierId, index: Number(m[2]) } : null
})
const tierId = computed<TierId | null>(() => parsed.value?.id ?? null)
const tierIndex = computed(() => parsed.value?.index ?? 0)
const t = computed(() => tierId.value ? ctx.tierType(tierId.value, tierIndex.value) : {})
const orientation = computed(() => t.value.orientation || 'horizontal')
function patch(p: Record<string, unknown>) { if (tierId.value) ctx.setTierType(tierId.value, p, tierIndex.value) }
</script>

<template>
  <div v-if="tierId" class="px-4 py-3.5 flex flex-col gap-2.5">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Type · {{ tierId }}<span v-if="tierIndex > 0"> · item {{ tierIndex + 1 }}</span></p>
    <div>
      <span class="text-[10px] text-white/40">Font</span>
      <TemplatesFontPicker :model-value="t.fontFamily || 'Inter'" @update:model-value="(f: string) => patch({ fontFamily: f })" />
    </div>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Weight</span>
      <select class="h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white"
        :value="t.fontWeight || 400" @change="(e: any) => patch({ fontWeight: Number(e.target.value) })">
        <option :value="400">Regular</option>
        <option :value="700">Bold</option>
      </select>
    </label>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Tracking</span>
      <input type="number" step="0.5" :value="t.letterSpacing ?? 0"
        class="w-20 h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-right"
        @change="(e: any) => patch({ letterSpacing: Number(e.target.value) })">
    </label>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Colour</span>
      <input type="text" :value="t.color ?? ''" placeholder="{{ brand.foreground }}"
        class="w-32 h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white font-mono"
        @change="(e: any) => patch({ color: e.target.value })">
    </label>
    <div class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Orientation</span>
      <div class="flex rounded border border-white/[0.06] overflow-hidden">
        <button v-for="o in (['horizontal', 'up', 'down'] as const)" :key="o"
          class="h-7 px-2 text-[10px] font-semibold transition-colors cursor-pointer"
          :class="orientation === o ? 'bg-action text-white' : 'bg-white/[0.04] text-white/50 hover:text-white/80'"
          @click="patch({ orientation: o })">
          {{ o === 'horizontal' ? 'Horizontal' : o === 'up' ? 'Up' : 'Down' }}
        </button>
      </div>
    </div>
    <p class="text-[10px] text-white/30 leading-snug">These ride the tier — they survive Shuffle / Surprise.</p>
  </div>
</template>
