<script setup lang="ts">
// Shared collapsible section for the studio editors' controls column. Bordered card,
// muted title with a rotating chevron, optional badge (prop or #badge slot, e.g. a
// StudioSwitch) on the right. No standalone dividers — the card border is the structure.
//
// Flat fill, no sheen. Two drifting specular gradients used to sit behind the content to
// fake frosted glass; they read as a smear across every card in a column of eight, and
// the controls inside are flat percentages of white, so the gradient was the odd surface.
// Removed 2026-08-06 — with it goes the `--studio-scroll` publisher in StudioModalShell,
// which existed only to drive their parallax.
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ title: string; badge?: string; open?: boolean }>(), { open: true })
const isOpen = ref(props.open)
// Re-apply the open prop when it changes (e.g. switching effects in Type Studio
// re-targets the same section instances at a new effect's default open-state).
watch(() => props.open, v => { isOpen.value = !!v })
</script>

<template>
  <details :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open"
           class="relative shrink-0 overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.04]">
    <summary class="relative flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] font-medium text-white/50 [&::-webkit-details-marker]:hidden">
      <span class="flex items-center gap-1.5">
        <span class="inline-block text-white/30 transition-transform" :class="isOpen ? 'rotate-90' : ''">›</span>
        {{ title }}
      </span>
      <slot name="badge">
        <span v-if="badge" class="text-[10px] uppercase tracking-wide text-white/30">{{ badge }}</span>
      </slot>
    </summary>
    <div class="relative space-y-3 px-3 pb-3 pt-0.5">
      <slot />
    </div>
  </details>
</template>
