<script setup lang="ts">
// Shared modal chrome for the studio editors (Space Type, Gradient, Shader). Header
// (title · breadcrumb · esc/close, separated from the body by spacing — no divider rule)
// + big preview/actions on the left and a scrollable controls column on the right. No
// vertical rail seam. Change the chrome here and all three editors update.
//
// The controls column publishes its scroll offset as the `--studio-scroll` CSS var so the
// frosted-glass StudioSection cards can drift their specular/refraction as you scroll.
import { ref } from 'vue'

defineProps<{ title?: string; breadcrumb?: string }>()
const emit = defineEmits<{ close: [] }>()

const controlsEl = ref<HTMLElement | null>(null)
let raf = 0
function onControlsScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const el = controlsEl.value
    if (el) el.style.setProperty('--studio-scroll', String(el.scrollTop))
  })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex h-[640px] max-h-[92vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white">
      <div class="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <span class="text-[13px] font-medium tracking-[-0.01em] text-white/90">{{ title }}</span>
        <template v-if="breadcrumb">
          <span class="text-xs text-white/25">/</span>
          <span class="text-xs text-white/50">{{ breadcrumb }}</span>
        </template>
        <span class="flex-1"></span>
        <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
        <button type="button" aria-label="Close" @click="emit('close')"
                class="text-white/45 transition-colors hover:text-white/80">✕</button>
      </div>
      <div class="flex min-h-0 flex-1 gap-4 p-4">
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex min-h-0 flex-1 items-center justify-center"><slot name="preview" /></div>
          <div class="mt-3 flex shrink-0 items-center gap-2"><slot name="actions" /></div>
        </div>
        <div ref="controlsEl" @scroll="onControlsScroll" class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pr-1 min-h-0"><slot name="controls" /></div>
      </div>
    </div>
  </div>
</template>
