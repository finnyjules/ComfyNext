<script setup lang="ts">
// Shared studio action button, standardised on Vector Type Studio's footer buttons (the
// look we settled on as best): an action-blue primary, a subtle bordered secondary, both
// 12px medium on a 6px radius with a firm disabled state. Change it here and every studio
// footer — Space Type, Scene3D, Texture, Gradient, Shape, Shader — updates together.
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'subtle'; disabled?: boolean }>(), { variant: 'secondary' })
const CLS: Record<string, string> = {
  primary: 'bg-action text-white enabled:hover:bg-action/85',
  secondary: 'border border-white/10 bg-white/[0.06] text-white/80 enabled:hover:bg-white/[0.12]',
  subtle: 'text-white/55 enabled:hover:text-white/85',
}
</script>

<template>
  <button type="button" :disabled="disabled"
          class="shrink-0 whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          :class="CLS[variant]">
    <slot />
  </button>
</template>
