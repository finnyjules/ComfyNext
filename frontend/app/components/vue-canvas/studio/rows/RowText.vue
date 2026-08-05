<script setup lang="ts">
// Value side of a text row: an always-editable right-aligned field. Unlike numbers,
// there is no drag gesture to protect, so it needs no editing mode.
//
// The field carries a resting fill rather than `bg-transparent`. Empty and transparent,
// a text row is a label with nothing beside it — on a node's `Lora url` there was no sign
// anything could be typed there. The fill is the affordance; focus brightens it.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
</script>

<template>
  <input
    :value="value"
    :aria-label="spec.label"
    spellcheck="false"
    class="w-32 rounded-[4px] bg-white/[0.06] px-1.5 text-right text-[11px] text-white/90 outline-none focus:bg-white/[0.12]"
    @pointerdown.stop
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
