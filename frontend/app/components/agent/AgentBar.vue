<script setup lang="ts">
// The agent marker — VibeControlBar evolved with the canonical pastel-gradient
// stroke (always-on) + arrow send + quick-action chips. Presentational only:
// the parent owns useLayoutAgent and handles submit/chip.
import { ref } from 'vue'

defineProps<{ busy: boolean; error?: string; notice?: string }>()
const emit = defineEmits<{ submit: [phrase: string]; chip: [action: string] }>()

const phrase = ref('')
const QUICK = ['Apply brand', 'Adapt to all formats', 'Tighten spacing', 'Group selection']

function go() {
  const p = phrase.value.trim()
  if (p) { emit('submit', p); phrase.value = '' }
}
</script>

<template>
  <div>
    <div class="pastel-hairline flex items-center gap-2 rounded-md px-2.5 py-2" style="--pastel-hairline-bg: #141416;">
      <span class="text-[13px] text-white/90">✦</span>
      <input
        v-model="phrase" :disabled="busy" type="text"
        placeholder="Tighten the layout and warm the palette…"
        class="flex-1 bg-transparent text-[12px] text-white/90 placeholder:text-white/25 outline-none"
        @keydown.enter="go"
      >
      <button
        class="grid h-[26px] w-[30px] place-items-center rounded-md bg-white text-[13px] text-neutral-900 hover:bg-white/90 disabled:opacity-40"
        :disabled="busy || !phrase.trim()" @click="go"
      >↑</button>
    </div>
    <div class="mt-2.5 flex flex-wrap gap-1.5">
      <button
        v-for="q in QUICK" :key="q" :disabled="busy"
        class="rounded-full border border-white/[0.12] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60 hover:text-white/85 disabled:opacity-40"
        @click="emit('chip', q)"
      >{{ q }}</button>
    </div>
    <p v-if="error" class="mt-1.5 text-[11px] text-red-400/90">{{ error }}</p>
    <p v-else-if="notice" class="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-white/65">
      <span class="text-white/80">✦</span><span>{{ notice }}</span>
    </p>
  </div>
</template>

<style scoped>
/* Match the inpaint prompt exactly: the pastel ring blooms on focus (canonical
   .pastel-hairline does filter 0.15s + border 0.5px→1px). The class is on the
   wrapper here while the <input> is a child, so forward that bloom via
   :focus-within. No custom transition or glow — just the canonical behaviour. */
.pastel-hairline:focus-within {
  border-width: 1px;
  filter: saturate(1);
}
</style>
