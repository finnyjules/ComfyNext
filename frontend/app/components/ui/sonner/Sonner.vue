<script setup lang="ts">
import { Toaster as Sonner, type ToasterProps } from 'vue-sonner'

const props = withDefaults(defineProps<ToasterProps>(), {
  theme: 'dark',
  position: 'top-right',
  richColors: true,
  expand: true,
  closeButton: true,
})
</script>

<template>
  <Sonner
    v-bind="props"
    :style="{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--popover-foreground)', '--normal-border': 'var(--border)' }"
  />
</template>

<style>
/* Anchor toast inside <main> (position: relative) instead of viewport */
[data-sonner-toaster][data-theme="dark"] {
  position: absolute !important;
  top: 56px !important;
  right: 12px !important;
  z-index: 50 !important;
}

/* Disable Sonner's default transitions to prevent flicker */
[data-sonner-toast] {
  transition: none !important;
}

/* Slide in from right, slide out to right */
[data-sonner-toast][data-mounted="true"] {
  animation: slide-in-right 0.3s ease-out !important;
}

[data-sonner-toast][data-removed="true"] {
  animation: slide-out-right 0.2s ease-in forwards !important;
}

@keyframes slide-in-right {
  from { transform: translateX(calc(100% + 12px)); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slide-out-right {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(calc(100% + 12px)); opacity: 0; }
}
</style>
