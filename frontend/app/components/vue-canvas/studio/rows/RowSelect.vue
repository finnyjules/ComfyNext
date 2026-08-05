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

// `v-model`, NOT `:value` + `@change`, and the reason is SELECTEDNESS, not the value
// binding. The failure this guards against: HTML resets a select's selectedness whenever
// its option list changes, so a value set against an EMPTY select matches nothing
// (`selectedIndex === -1`) and, once options are appended, the reset picks the FIRST
// option instead. That would leave the row's text showing the stored value while the
// native control reported `options[0]` — the menu opens on the wrong row, and picking
// `options[0]` fires no `change` at all, so it is unpickable.
//
// HONEST NOTE, because this was measured rather than reasoned: `:value` does NOT
// actually break here at Vue 3. Both of Vue's prop-patch paths special-case
// `key === 'value'` and re-patch it even when it is unchanged, and `patchElement`
// patches children BEFORE props — so `el.value` is re-asserted after the new options
// exist. Counterfactual on the harness, `:value` + `@change`, the effectId spec's
// options merged in after mount with a stored value of `topographic`: selectedIndex went
// -1 → 3, i.e. correct. `v-model` is kept anyway because it makes the guarantee
// explicit and cheap: vModelSelect sets `option.selected` from an `updated` hook, which
// is the mechanism that survives Vue changing the `key === 'value'` fast path.
//
// Verified with real input on the late-populated select: picking `options[0]` fired one
// `change`, wrote once, and the row text and `select.value` agreed.
const model = computed({
  get: () => props.value,
  set: (v: string) => emit('update:value', v),
})
</script>

<template>
  <span class="relative flex items-center gap-1 text-[11px] text-white/90">
    <span class="capitalize">{{ value }}</span>
    <span class="text-white/35">⌄</span>
    <select
      v-model="model"
      :aria-label="spec.label"
      class="absolute inset-0 cursor-pointer opacity-0"
      @pointerdown.stop
    >
      <option v-for="o in options" :key="o" :value="o" class="bg-neutral-900 capitalize">{{ o }}</option>
    </select>
  </span>
</template>
