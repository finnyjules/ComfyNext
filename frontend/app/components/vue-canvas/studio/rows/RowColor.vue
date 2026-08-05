<script setup lang="ts">
// Value side of a colour row: hex text then the existing StudioColor swatch, which
// keeps its own popover (saturation pad, hue, alpha, eyedropper, hex/RGB/OKLCH).
// The swatch is already 28px, so it fills the row height exactly.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioColor from '../StudioColor.vue'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()

const proxy = computed({
  get: () => props.value,
  set: (v: string) => emit('update:value', v),
})
</script>

<template>
  <span class="flex items-center gap-2" @pointerdown.stop>
    <span class="font-mono text-[11px] uppercase text-white/90">{{ value }}</span>
    <StudioColor v-model="proxy" />
  </span>
</template>
