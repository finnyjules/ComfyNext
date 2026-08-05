<script setup lang="ts">
// Value side of a boolean row. Reuses the app's existing switch look rather than
// inventing a second one.
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: boolean; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: boolean): void }>()
</script>

<template>
  <button
    type="button" role="switch" :aria-checked="value" :aria-label="spec.label"
    class="relative h-[16px] w-[28px] rounded-full transition-colors"
    :class="value ? 'bg-white' : 'bg-white/15'"
    @pointerdown.stop
    @click.stop="emit('update:value', !props.value)"
  >
    <span
      class="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all"
      :class="value ? 'left-[14px] bg-neutral-900' : 'left-[2px] bg-white/70'"
    ></span>
  </button>
</template>
