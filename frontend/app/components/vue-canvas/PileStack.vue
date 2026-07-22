<script setup lang="ts">
// Shared messy-pile visual — cover (never cropped) + up to two id-seeded
// tilted peek cards + count badge — extracted from BatchGridNode so the
// BatchGrid and SketchPile decks cannot drift. Purely presentational:
// actions live in the caller via the #rail slot (under the badge, top-right).
const props = defineProps<{
  images: string[]      // full-size URLs, [0] = cover
  seedKey: string       // node id — seeds deterministic per-node tilt
  selected?: boolean
  dashed?: boolean      // sketch identity: dashed neutral ring on the cover
  loading?: boolean     // skeleton pile (dashed shimmer) while a batch is in flight
}>()

// Deterministic per node (id-seeded) so the pile doesn't reshuffle on every
// re-render, but different nodes lean differently.
const seed = computed(() => [...String(props.seedKey)].reduce((a, ch) => a + ch.charCodeAt(0), 0))
const tilt = (i: number) => {
  const base = [-6, 5, -2][i % 3]!
  return base + ((seed.value >> (i * 2)) % 3) - 1
}
const peeks = computed(() => props.images.slice(1, 3))
</script>

<template>
  <div class="relative flex justify-center w-full">
    <div class="relative inline-block max-w-full">
      <template v-if="!loading && images[0]">
        <!-- peek cards — real outputs poking out at odd angles (cropped to the
             cover's box; they're decorative backdrop) -->
        <img
          v-for="(peek, i) in peeks"
          :key="peek"
          :src="peek"
          class="absolute inset-0 w-full h-full object-cover rounded-lg border border-white/15 shadow-lg"
          :style="{ transform: `rotate(${tilt(i + 1)}deg) translate(${(i + 1) * 4}px, ${(i + 1) * 3}px)` }"
          draggable="false"
        >
        <!-- cover — never cropped -->
        <img
          :src="images[0]"
          :class="['pile-cover relative block max-w-full max-h-[190px] w-auto h-auto rounded-lg border shadow-xl',
                   dashed ? 'border-dashed' : '',
                   selected ? 'border-action ring-2 ring-action/40' : (dashed ? 'border-white/30' : 'border-white/20')]"
          :style="{ transform: `rotate(${tilt(0) / 3}deg)` }"
          draggable="false"
        >
      </template>
      <div
        v-else-if="loading"
        class="pile-skeleton gen-stroke relative w-[190px] h-[150px] rounded-lg"
        aria-label="Sketching…"
      />
      <div v-else class="relative w-[190px] h-[150px] rounded-lg bg-white/[0.05] border border-dashed border-white/15 flex items-center justify-center text-white/30 text-xs">
        no outputs
      </div>
      <!-- top-right rail: count badge with the caller's actions stacked under it -->
      <div class="absolute -top-2 -right-2 flex flex-col items-center gap-1.5 nopan nodrag">
        <span
          v-if="images.length && !loading"
          class="min-w-6 h-6 px-1.5 rounded-full bg-action text-white text-[11px] font-semibold flex items-center justify-center shadow-md"
        >
          {{ images.length }}
        </span>
        <slot name="rail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* NEUTRAL shimmer fill (never pastel/purple); the stroke is the shared
   .gen-stroke rotating translucent gradient ring (main.css). */
.pile-skeleton {
  background: linear-gradient(100deg, rgba(255,255,255,.04) 40%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 60%);
  background-size: 200% 100%;
  animation: pile-shimmer 1.1s linear infinite;
}
@keyframes pile-shimmer { to { background-position: -200% 0; } }
</style>
