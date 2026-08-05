<script setup lang="ts">
// Value side of a text row: an always-editable right-aligned field. Unlike numbers,
// there is no drag gesture to protect, so it needs no editing mode.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
</script>

<template>
  <input
    :value="value"
    spellcheck="false"
    class="w-32 rounded-[4px] bg-transparent px-1 text-right text-[11px] text-white/90 outline-none focus:bg-white/10"
    @pointerdown.stop
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
  />
</template>
