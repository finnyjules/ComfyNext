<script setup lang="ts">
// Shared studio action button. White primary (the unified accent), ghost secondary,
// muted subtle. Used across all three studio footers.
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'subtle'; disabled?: boolean }>(), { variant: 'secondary' })
const CLS: Record<string, string> = {
  primary: 'bg-white text-neutral-900 hover:bg-white/90',
  secondary: 'border border-white/15 text-white/85 hover:bg-white/10',
  subtle: 'text-white/50 hover:text-white/80',
}
</script>

<template>
  <button type="button" :disabled="disabled"
          class="rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          :class="CLS[variant]">
    <slot />
  </button>
</template>
