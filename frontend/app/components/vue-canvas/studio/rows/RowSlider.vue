<script setup lang="ts">
// The value side of a numeric row: a mono readout that becomes an input when the row
// says it is being edited. The row shell owns dragging, the fill, and committing —
// this only renders, so the two never fight over the pointer.
import { ref, watch, nextTick } from 'vue'
import { formatValue } from '~/lib/studio/row'

import type { ControlSpec } from '~/lib/spacetype/effect'

const props = defineProps<{
  value: number
  spec: ControlSpec
  step: number
  editing: boolean
}>()
const emit = defineEmits<{ (e: 'commit', raw: string): void; (e: 'cancel'): void }>()

const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

// Escape must leave the value alone, and Chrome fires `blur` on a focused element
// the moment it is removed from the DOM — so cancelling unmounts the input, which
// then fires the blur-commit and writes the draft anyway. Observed: type 99, press
// Escape, get 99. This latch makes the unmount-blur that follows a cancel a no-op.
let cancelling = false

function cancel() {
  cancelling = true
  emit('cancel')
}
function commit() {
  if (cancelling) return
  emit('commit', draft.value)
}

watch(() => props.editing, async (on) => {
  if (!on) return
  cancelling = false
  draft.value = formatValue(props.value, props.step)
  await nextTick()
  input.value?.select()
})
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    v-model="draft"
    spellcheck="false"
    class="w-16 rounded-[4px] bg-white/10 px-1 text-right font-mono text-[11px] text-white outline-none"
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="cancel"
    @blur="commit"
    @pointerdown.stop
  />
  <span v-else class="font-mono text-[11px] text-white/90">{{ formatValue(value, step) }}</span>
</template>
