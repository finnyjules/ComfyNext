<script setup lang="ts">
// Shared collapsible section for the studio editors' controls column. Bordered card,
// muted title with a rotating chevron, optional badge (prop or #badge slot, e.g. a
// StudioSwitch) on the right. No standalone dividers — the card border is the structure.
import { ref } from 'vue'

const props = withDefaults(defineProps<{ title: string; badge?: string; open?: boolean }>(), { open: true })
const isOpen = ref(props.open)
</script>

<template>
  <details :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open"
           class="rounded-lg border border-white/[0.07] bg-white/[0.03]">
    <summary class="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] font-medium text-white/50 [&::-webkit-details-marker]:hidden">
      <span class="flex items-center gap-1.5">
        <span class="inline-block text-white/30 transition-transform" :class="isOpen ? 'rotate-90' : ''">›</span>
        {{ title }}
      </span>
      <slot name="badge">
        <span v-if="badge" class="text-[10px] uppercase tracking-wide text-white/30">{{ badge }}</span>
      </slot>
    </summary>
    <div class="space-y-3 px-3 pb-3 pt-0.5">
      <slot />
    </div>
  </details>
</template>
