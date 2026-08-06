<script setup lang="ts">
// Value side of a text row: an always-editable right-aligned field. Unlike numbers,
// there is no drag gesture to protect, so it needs no editing mode.
//
// The resting fill is deliberately FAINTER than a control's would normally be. Two
// pressures meet here: empty and fully transparent, a text row is a label with nothing
// beside it and nothing says you can type; but at control strength it reads as a box
// inside the row's own box, which no slider row has — the slider's fill sits BEHIND the
// whole row, so a nested panel is the thing that looks out of place in a column of them.
// 3% hints without enclosing; hover and focus do the rest.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
</script>

<template>
  <input
    :value="value"
    :aria-label="spec.label"
    spellcheck="false"
    class="w-32 rounded-[3px] bg-white/[0.03] px-1.5 text-right text-[11px] text-white/90 outline-none transition-colors hover:bg-white/[0.07] focus:bg-white/[0.10]"
    @pointerdown.stop
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
