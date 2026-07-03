<!-- frontend/app/components/vue-canvas/NextStepsStrip.vue -->
<script setup lang="ts">
// Transient post-render escalator chips (ARPU lever 5 surface). Two kinds:
// generic suggestions (quiet dark chips, 12s TTL) and reviewer FIX chips
// (pastel = AI; sticky until clicked/dismissed/stale). The parent decides
// WHEN to show the strip and which channels are live; this component only
// renders, times out the generic half, and reports dismissal.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Shuffle, ZoomIn, Clapperboard, MoreHorizontal, Sparkles } from 'lucide-vue-next'
import { ACTION_HINTS } from '~/lib/artifact/nextSteps'
import type { FixChip } from '~/composables/useNextStepsStrip'

const emit = defineEmits<{
  (e: 'variations' | 'upscale' | 'animate' | 'more' | 'dismiss' | 'timeout'): void
}>()

defineProps<{ canVary: boolean; showGeneric: boolean; fixChips?: FixChip[] }>()

const rootRef = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

function onWindowPointerDown(ev: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(ev.target as Node)) emit('dismiss')
}
onMounted(() => {
  // The timer retires only the generic suggestions ('timeout'); reviewer fix
  // chips are sticky — they arrive ~10s late by nature — and clear on click,
  // explicit dismissal (outside pointerdown), or a newer render.
  timer = setTimeout(() => emit('timeout'), 12_000)
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
})

function pick(action: 'variations' | 'upscale' | 'animate' | 'more') {
  emit(action)
  if (action !== 'more') emit('dismiss')
}
</script>

<template>
  <div
    ref="rootRef"
    class="nopan nodrag next-steps-strip flex items-center gap-1 px-1.5 py-1 border-t border-white/5 bg-black/60"
  >
    <!-- Reviewer fixes lead the strip. Pastel = AI. -->
    <button
      v-for="chip in fixChips ?? []"
      :key="chip.id"
      class="ns-chip-fix gen-pastel"
      style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.55), rgba(207,232,255,.55), rgba(214,255,224,.55), rgba(255,244,204,.55), rgba(231,214,255,.55), rgba(255,214,231,.55));"
      :title="chip.hint ? `${chip.label} (${chip.hint})` : chip.label"
      @click.stop="chip.apply()"
    >
      <Sparkles class="size-2.5" /> {{ chip.label }}
      <span v-if="chip.hint" class="ns-hint-fix">{{ chip.hint }}</span>
    </button>
    <template v-if="showGeneric">
      <span class="text-[9px] text-white/30 pr-0.5 select-none">Next</span>
      <button v-if="canVary" class="ns-chip" title="Re-run the generator 4× with fresh seeds" @click.stop="pick('variations')">
        <Shuffle class="size-2.5" /> Variations
      </button>
      <button class="ns-chip" :title="`Upscale (${ACTION_HINTS.upscale})`" @click.stop="pick('upscale')">
        <ZoomIn class="size-2.5" /> Upscale <span class="ns-hint">{{ ACTION_HINTS.upscale }}</span>
      </button>
      <button class="ns-chip" title="Animate — direct a video shot from this image" @click.stop="pick('animate')">
        <Clapperboard class="size-2.5" /> Animate
      </button>
    </template>
    <span class="flex-1" />
    <button class="ns-chip" title="All edit and enhance actions" @click.stop="pick('more')">
      <MoreHorizontal class="size-2.5" />
    </button>
  </div>
</template>

<style scoped>
.next-steps-strip {
  animation: ns-in 0.18s ease-out;
}
@keyframes ns-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.ns-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 10px;
  color: rgb(255 255 255 / 0.7);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.ns-chip:hover {
  color: #fff;
  background-color: rgb(255 255 255 / 0.1);
}
.ns-hint {
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.35);
}
.ns-chip-fix {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.5rem;
  border-radius: 0.25rem;
  font-size: 10px;
  font-weight: 500;
  color: #171717;
  cursor: pointer;
  transition: filter 0.15s;
}
.ns-chip-fix:hover { filter: brightness(1.08); }
.ns-hint-fix {
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  color: rgb(23 23 23 / 0.55);
}
</style>
