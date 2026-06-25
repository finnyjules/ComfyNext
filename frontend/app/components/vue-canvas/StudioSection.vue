<script setup lang="ts">
// Shared collapsible section for the studio editors' controls column. Bordered card,
// muted title with a rotating chevron, optional badge (prop or #badge slot, e.g. a
// StudioSwitch) on the right. No standalone dividers — the card border is the structure.
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
/* Frosted look without backdrop-filter (invisible over the solid bg, and a per-scroll-frame
   cost): a translucent fill (the bg-white utility) + the uniform hairline border + a faint
   drifting sheen. No top edge-highlight — it read as a heavier top border. */
.studio-sheen { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
/* Two parallax specular sheens drifting with scroll. Driven by `transform` (compositor-only —
   no layout/paint), so scrolling stays smooth. */
.studio-sheen::before,
.studio-sheen::after {
  content: '';
  position: absolute;
  left: -30%;
  right: -30%;
  top: -50%;
  height: 200%;
  will-change: transform;
}
.studio-sheen::before {
  transform: translateY(calc(var(--studio-scroll, 0) * 0.4px));
  background: linear-gradient(115deg, transparent 18%, rgba(255, 255, 255, 0.055) 50%, transparent 82%);
}
.studio-sheen::after {
  transform: translateY(calc(var(--studio-scroll, 0) * 0.22px));
  background: linear-gradient(115deg, transparent 28%, rgba(255, 255, 255, 0.03) 50%, transparent 72%);
}
</style>
