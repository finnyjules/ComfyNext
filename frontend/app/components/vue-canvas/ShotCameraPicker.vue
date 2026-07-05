<script setup lang="ts">
// Shot Director — visual camera controls. Replaces the three <select> dropdowns
// (shot type / move / pacing) with things you point at: a row of framing-scale
// glyphs, a grid of directional move glyphs, and a compact pacing segment.
// Recognition over recall — the whole reason the tool now "feels visual".
import { ZoomIn, ZoomOut, MoveHorizontal, ArrowLeftRight, Orbit, Plane, Activity, Lock } from 'lucide-vue-next'
import { SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, type ShotType, type CameraMove, type Pacing } from '~/lib/shotdirector/types'

defineProps<{ shotType: ShotType; move: CameraMove; pacing: Pacing }>()
const emit = defineEmits<{
  (e: 'update:shotType', v: ShotType): void
  (e: 'update:move', v: CameraMove): void
  (e: 'update:pacing', v: Pacing): void
}>()

// Framing glyph geometry per shot type: a 44×26 frame with a subject circle whose
// size + vertical position conveys how tight the shot is.
const SHOT_GLYPH: Record<ShotType, { r: number; cy: number }> = {
  'establishing': { r: 2.4, cy: 18 },
  'wide': { r: 4.5, cy: 16 },
  'medium': { r: 7, cy: 18 },
  'close-up': { r: 11, cy: 20 },
  'extreme-close-up': { r: 17, cy: 22 },
}
const SHOT_ORDER: ShotType[] = ['establishing', 'wide', 'medium', 'close-up', 'extreme-close-up']
const SHOT_LABEL: Record<ShotType, string> = {
  'establishing': 'Establish', 'wide': 'Wide', 'medium': 'Medium', 'close-up': 'Close', 'extreme-close-up': 'Extreme',
}

const MOVE_ICON = {
  'push-in': ZoomIn, 'pull-out': ZoomOut, 'pan': MoveHorizontal, 'track': ArrowLeftRight,
  'orbit': Orbit, 'aerial': Plane, 'handheld': Activity, 'locked-off': Lock,
} as const
const MOVE_ORDER: CameraMove[] = ['push-in', 'pull-out', 'pan', 'track', 'orbit', 'aerial', 'handheld', 'locked-off']
// Short chip labels (the phrase map is prose-oriented, e.g. "locked-off, static camera").
const MOVE_LABEL: Record<CameraMove, string> = {
  'push-in': 'Push in', 'pull-out': 'Pull out', 'pan': 'Pan', 'track': 'Track',
  'orbit': 'Orbit', 'aerial': 'Aerial', 'handheld': 'Handheld', 'locked-off': 'Locked',
}

const PACING: Pacing[] = ['slow', 'smooth', 'gradual', 'gentle']
</script>

<template>
  <div class="space-y-3">
    <!-- Shot type — framing scale -->
    <div>
      <label class="mb-1.5 block text-[11px] text-white/45">Framing</label>
      <div class="grid grid-cols-5 gap-1.5">
        <button
          v-for="t in SHOT_ORDER" :key="t"
          type="button"
          :title="SHOT_TYPE_PHRASE[t]"
          class="group flex flex-col items-center gap-1 rounded-md border py-1.5 transition-colors"
          :class="shotType === t
            ? 'border-white/35 bg-white/10'
            : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'"
          @click="emit('update:shotType', t)"
        >
          <svg viewBox="0 0 44 26" class="w-full px-1" style="height: 22px">
            <rect x="1" y="1" width="42" height="24" rx="2.5" fill="none"
                  :stroke="shotType === t ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.18)'" stroke-width="1" />
            <clipPath :id="`fr-${t}`"><rect x="1" y="1" width="42" height="24" rx="2.5" /></clipPath>
            <circle :cx="22" :cy="SHOT_GLYPH[t].cy" :r="SHOT_GLYPH[t].r" :clip-path="`url(#fr-${t})`"
                    :fill="shotType === t ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)'" />
          </svg>
          <span class="text-[9px] leading-none" :class="shotType === t ? 'text-white/80' : 'text-white/35'">
            {{ SHOT_LABEL[t] }}
          </span>
        </button>
      </div>
    </div>

    <!-- Camera move — one only -->
    <div>
      <label class="mb-1.5 flex items-center justify-between text-[11px] text-white/45">
        <span>Camera move</span>
        <span class="text-[10px] text-white/25">one per shot</span>
      </label>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="m in MOVE_ORDER" :key="m"
          type="button"
          :title="CAMERA_MOVE_PHRASE[m]"
          class="flex flex-col items-center gap-1 rounded-md border py-2 transition-colors"
          :class="move === m
            ? 'border-white/35 bg-white/10 text-white/90'
            : 'border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20 hover:bg-white/[0.05] hover:text-white/70'"
          @click="emit('update:move', m)"
        >
          <component :is="MOVE_ICON[m]" class="h-4 w-4" />
          <span class="text-[9px] leading-none">{{ MOVE_LABEL[m] }}</span>
        </button>
      </div>
    </div>

    <!-- Pacing — compact segment -->
    <div>
      <label class="mb-1.5 block text-[11px] text-white/45">Pacing</label>
      <div class="flex gap-1">
        <button
          v-for="p in PACING" :key="p"
          type="button"
          class="flex-1 rounded border py-1 text-[10px] capitalize transition-colors"
          :class="pacing === p
            ? 'border-white/30 bg-white/10 text-white/80'
            : 'border-white/10 text-white/35 hover:border-white/20 hover:text-white/60'"
          @click="emit('update:pacing', p)"
        >{{ p }}</button>
      </div>
    </div>
  </div>
</template>
