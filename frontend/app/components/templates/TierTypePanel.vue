<script setup lang="ts">
import type { TierId } from '~~/shared/template-grid/types'

const ctx = inject<any>('gridEditor')

const tierId = computed<TierId | null>(() => {
  const id = ctx?.selectedElement?.value?.id as string | undefined
  return id?.startsWith('tier_') ? (id.slice(5) as TierId) : null
})
const t = computed(() => tierId.value ? ctx.tierType(tierId.value) : {})
function patch(p: Record<string, unknown>) { if (tierId.value) ctx.setTierType(tierId.value, p) }
</script>

<template>
  <div v-if="tierId" class="px-4 py-3.5 flex flex-col gap-2.5">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Type · {{ tierId }}</p>
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
    <p class="text-[10px] text-white/30 leading-snug">These ride the tier — they survive Shuffle / Surprise.</p>
  </div>
</template>
