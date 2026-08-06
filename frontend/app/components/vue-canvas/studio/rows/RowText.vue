<script setup lang="ts">
// Value side of a text row: an always-editable right-aligned field. Unlike numbers,
// there is no drag gesture to protect, so it needs no editing mode.
//
// NO resting fill. A slider row's fill sits BEHIND the whole row, so any field with a
// background of its own reads as a box inside a box — and a merely fainter box still
// reads as one, which is how this landed at 6%, then 3%, then nothing. The field is
// invisible until you go near it: hover raises it, focus raises it further.
//
// The empty state is the cost, and it is paid by the placeholder. Without one, an empty
// text row would be a label with nothing beside it and no sign you can type — which is
// why `placeholder` is not optional dressing here.
import type { ControlSpec } from '~/lib/spacetype/effect'

// `placeholder` defaults to an em dash rather than repeating the label, which already sits
// on the left of the same row. It is declared (not left to fall through) so it cannot land
// on the input as a stray attribute, and it is the only prop here beyond the four every
// renderer takes — StudioRow does not pass it, so the default is what ships.
const props = withDefaults(
  defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean; placeholder?: string }>(),
  { placeholder: '—' },
)
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
</script>

<template>
  <input
    :value="value"
    :aria-label="spec.label"
    spellcheck="false"
    :placeholder="placeholder"
    class="w-32 rounded-[6px] bg-transparent px-1.5 text-right text-[11px] text-white/90 placeholder:text-white/25 outline-none transition-colors hover:bg-white/[0.06] focus:bg-white/[0.10]"
    @pointerdown.stop
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
