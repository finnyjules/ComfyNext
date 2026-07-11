<script setup lang="ts">
import type { BrandKit } from '~~/shared/brand/types'

defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()
</script>

<template>
  <div class="space-y-2 text-xs">
    <BrandPalettePanel :kit="kit" @update="(p) => emit('update', p)" />
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Display font</span>
      <TemplatesFontPicker :model-value="kit.fontDisplay ?? ''" @update:model-value="(v: string) => emit('update', { fontDisplay: v })" />
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Body font</span>
      <TemplatesFontPicker :model-value="kit.fontBody ?? ''" @update:model-value="(v: string) => emit('update', { fontBody: v })" />
    </div>
    <div class="space-y-1">
      <span class="text-white/60">Logos</span>
      <BrandLogoSlotsPanel :kit="kit" @update="(p) => emit('update', p)" />
    </div>
  </div>
</template>
