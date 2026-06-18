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
           class="studio-glass relative overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.04]">
    <div class="studio-sheen" aria-hidden="true"></div>
    <summary class="relative z-10 flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2.5 text-[11px] font-medium text-white/50 [&::-webkit-details-marker]:hidden">
      <span class="flex items-center gap-1.5">
        <span class="inline-block text-white/30 transition-transform" :class="isOpen ? 'rotate-90' : ''">›</span>
        {{ title }}
      </span>
      <slot name="badge">
        <span v-if="badge" class="text-[10px] uppercase tracking-wide text-white/30">{{ badge }}</span>
      </slot>
    </summary>
    <div class="relative z-10 space-y-3 px-3 pb-3 pt-0.5">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.studio-glass {
  backdrop-filter: blur(6px) saturate(1.2);
  -webkit-backdrop-filter: blur(6px) saturate(1.2);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.studio-sheen { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.studio-sheen::before,
.studio-sheen::after { content: ''; position: absolute; left: -30%; right: -30%; height: 200%; will-change: top; }
/* Drifts faster + refracts (SVG displacement) — the "live glass" layer. */
.studio-sheen::before {
  top: calc(-50% + var(--studio-scroll, 0) * 0.4px);
  background: linear-gradient(115deg, transparent 43%, rgba(255, 255, 255, 0.14) 50%, transparent 57%);
  filter: url(#studioRefract);
}
/* A slower, un-refracted second sheen for parallax depth. */
.studio-sheen::after {
  top: calc(-50% + var(--studio-scroll, 0) * 0.22px);
  background: linear-gradient(115deg, transparent 47%, rgba(255, 255, 255, 0.06) 50%, transparent 53%);
}
</style>
