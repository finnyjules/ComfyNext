<script setup lang="ts">
/**
 * Canvas sketch review strip — four instant sketches, docked above the prompt
 * bar, reviewed before any land. PRESENTATION + gesture only: it shows the
 * images and reports what the user did (hover/select/keep/cancel/reroll, and —
 * Task 2 — dropAt). The canvas host turns a commit into one image node and
 * tears down the transient sketch-pad state. Borrows the take strip's calm
 * vocabulary but is its own component (canvas context: finished sketch images,
 * drag-to-place, no studio preview to drive).
 */
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'

const props = withDefaults(defineProps<{
  images: string[]
  selected: number | null
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  hover: [index: number | null]
  select: [index: number]
  keep: []
  cancel: []
  reroll: []
}>()

const hovered = ref<number | null>(null)
function onHover(i: number | null) { hovered.value = i; emit('hover', i) }

const TILE = 'relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-[6px] border border-white/12 transition enabled:cursor-pointer hover:border-white/30'
</script>

<template>
  <div data-testid="sketch-strip"
       class="flex items-center gap-1.5 rounded-[9px] border border-white/10 bg-[#0b0d11]/95 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
    <div class="flex items-center gap-1.5">
      <button v-for="(src, i) in images" :key="i" data-testid="sketch-tile" type="button"
              :data-index="i" :aria-pressed="selected === i ? 'true' : 'false'"
              :class="[TILE, selected === i ? 'border-action ring-1 ring-action' : '']"
              @mouseenter="onHover(i)" @mouseleave="onHover(null)" @focus="onHover(i)" @blur="onHover(null)"
              @click="emit('select', i)">
        <img :src="src" alt="" class="h-full w-full object-cover">
        <!-- hover preview: a larger look, floated above this tile -->
        <div v-if="hovered === i" data-testid="sketch-tip"
             class="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 h-[128px] w-[128px] -translate-x-1/2 overflow-hidden rounded-[8px] border border-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
          <img :src="src" alt="" class="h-full w-full object-cover">
        </div>
      </button>
    </div>

    <div data-testid="sketch-actions" class="ml-1 flex items-center gap-2 border-l border-white/10 pl-2">
      <StudioButton data-testid="sketch-cancel" variant="subtle" @click="emit('cancel')">Cancel</StudioButton>
      <StudioButton data-testid="sketch-reroll" variant="neutral" :disabled="busy" @click="emit('reroll')">↻ Re-roll</StudioButton>
      <StudioButton data-testid="sketch-keep" variant="primary" :disabled="busy || selected === null" @click="emit('keep')">Keep</StudioButton>
    </div>
  </div>
</template>
