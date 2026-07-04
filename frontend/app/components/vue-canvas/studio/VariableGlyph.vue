<script setup lang="ts">
// Figma-style variable handle. Outline hexagon = "can become a variable" (one
// click promotes); filled = "is a variable" (click/right-click opens the manage
// menu). Pink (--var-accent) is the dedicated variable convention — distinct
// from emerald=run and pastel-gradient=AI, and never purple. The parent
// control row must be `.group` so the unbound glyph hover-reveals.
const props = defineProps<{ bound: string | null }>()
const emit = defineEmits<{ (e: 'promote'): void; (e: 'menu', event: MouseEvent): void }>()

function onClick(e: MouseEvent) {
  if (props.bound) emit('menu', e)
  else emit('promote')
}
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center transition-opacity"
    :class="bound ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'"
    style="color: var(--var-accent)"
    :title="bound ?? 'Make variable'"
    :aria-label="bound ? `Variable ${bound}` : 'Make variable'"
    @click.stop="onClick"
    @contextmenu.prevent.stop="emit('menu', $event)"
  >
    <svg width="13" height="14" viewBox="0 0 20 22" fill="none" aria-hidden="true">
      <path
        d="M10 1.5 18 6v10l-8 4.5L2 16V6z"
        :fill="bound ? 'currentColor' : 'none'"
        :stroke="bound ? 'none' : 'currentColor'"
        stroke-width="1.6"
      />
    </svg>
  </button>
</template>
