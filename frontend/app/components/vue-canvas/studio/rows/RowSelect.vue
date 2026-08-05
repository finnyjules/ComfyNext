<script setup lang="ts">
// Value side of a select row: the current option, right-aligned, with the native
// select laid transparently over it so the OS menu still opens where expected.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{ value: string; spec: ControlSpec; step: number; editing: boolean }>()
const emit = defineEmits<{ (e: 'update:value', v: string): void }>()
// Computed, not a setup-time snapshot: a row keeps ONE component instance for the
// life of its key, and several select specs get their options late or from live
// state — `shaderFillControls`' `effectId` ships `options: []` on purpose and the
// host merges the fetched 63-effect catalog in afterwards. Read once at setup, that
// row would offer an empty menu forever. Measured on the harness: mutating a spec's
// options left the rendered <option> list on the old values.
const options = computed(() => (props.spec as { options?: string[] }).options ?? [])
</script>

<template>
  <span class="relative flex items-center gap-1 text-[11px] text-white/90">
    <span class="capitalize">{{ value }}</span>
    <span class="text-white/35">⌄</span>
    <select
      :value="value"
      class="absolute inset-0 cursor-pointer opacity-0"
      @pointerdown.stop
      @change="emit('update:value', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in options" :key="o" :value="o" class="bg-neutral-900 capitalize">{{ o }}</option>
    </select>
  </span>
</template>
