<script setup lang="ts">
// Shot Director — visual camera controls. A framing-scale row, a move grid grouped
// by category, a contextual direction toggle (only for moves that have one), and a
// pacing segment. Recognition over recall; still one move per shot.
import {
  Lock, MoveHorizontal, MoveVertical, Wind, ZoomIn, ZoomOut, Minimize2, Maximize2,
  Move, ArrowLeftRight, ArrowUpDown, Spline, Orbit, ChevronsUpDown, Plane, Activity,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RotateCw, RotateCcw,
} from 'lucide-vue-next'
import {
  SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, MOVE_CATEGORY, MOVE_DIRECTIONS, MOVE_DEFAULT_DIR,
  type ShotType, type CameraMove, type CameraDirection, type MoveCategory, type Pacing,
} from '~/lib/shotdirector/types'
import { computed } from 'vue'

const props = defineProps<{ shotType: ShotType; move: CameraMove; pacing: Pacing; direction?: CameraDirection }>()
const emit = defineEmits<{
  (e: 'update:shotType', v: ShotType): void
  (e: 'update:move', v: CameraMove): void
  (e: 'update:direction', v: CameraDirection | undefined): void
  (e: 'update:pacing', v: Pacing): void
}>()

// ── Framing (shot type) ──────────────────────────────────────────────────────
const SHOT_GLYPH: Record<ShotType, { r: number; cy: number }> = {
  'establishing': { r: 2.4, cy: 18 }, 'wide': { r: 4.5, cy: 16 }, 'medium': { r: 7, cy: 18 },
  'close-up': { r: 11, cy: 20 }, 'extreme-close-up': { r: 17, cy: 22 },
}
const SHOT_ORDER: ShotType[] = ['establishing', 'wide', 'medium', 'close-up', 'extreme-close-up']
const SHOT_LABEL: Record<ShotType, string> = {
  'establishing': 'Establish', 'wide': 'Wide', 'medium': 'Medium', 'close-up': 'Close', 'extreme-close-up': 'Extreme',
}

// ── Moves, grouped by category ───────────────────────────────────────────────
const MOVE_ICON: Record<CameraMove, unknown> = {
  'locked-off': Lock,
  'pan': MoveHorizontal, 'tilt': MoveVertical, 'whip-pan': Wind,
  'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
  'push-in': Minimize2, 'pull-out': Maximize2, 'track': Move,
  'truck': ArrowLeftRight, 'pedestal': ArrowUpDown, 'arc': Spline,
  'orbit': Orbit,
  'aerial': Plane, 'crane': ChevronsUpDown,
  'handheld': Activity,
}
const CATEGORY_ORDER: MoveCategory[] = ['Static', 'Pan/Tilt', 'Zoom', 'Dolly', 'Physical', 'Orbit', 'Aerial', 'Human']
const MOVE_GROUPS = CATEGORY_ORDER.map(cat => ({
  cat,
  moves: (Object.keys(CAMERA_MOVE_PHRASE) as CameraMove[]).filter(m => MOVE_CATEGORY[m] === cat),
})).filter(g => g.moves.length)

// ── Direction ────────────────────────────────────────────────────────────────
const DIR_META: Record<CameraDirection, { icon: unknown; label: string }> = {
  left: { icon: ChevronLeft, label: 'Left' }, right: { icon: ChevronRight, label: 'Right' },
  up: { icon: ChevronUp, label: 'Up' }, down: { icon: ChevronDown, label: 'Down' },
  cw: { icon: RotateCw, label: 'CW' }, ccw: { icon: RotateCcw, label: 'CCW' },
}
const moveDirs = computed(() => MOVE_DIRECTIONS[props.move])
const activeDir = computed(() => props.direction ?? MOVE_DEFAULT_DIR[props.move])

function selectMove(m: CameraMove) {
  emit('update:move', m)
  // Seed the new move's default direction (or clear it for non-directional moves).
  emit('update:direction', MOVE_DEFAULT_DIR[m])
}

const PACING: Pacing[] = ['slow', 'smooth', 'gradual', 'gentle']
</script>

<template>
  <div class="space-y-3">
    <!-- Framing -->
    <div>
      <label class="mb-1.5 block text-[11px] text-white/45">Framing</label>
      <div class="grid grid-cols-5 gap-1.5">
        <button
          v-for="t in SHOT_ORDER" :key="t"
          type="button"
          :title="SHOT_TYPE_PHRASE[t]"
          class="group flex flex-col items-center gap-1 rounded border py-1.5 transition-colors"
          :class="shotType === t ? 'border-white/35 bg-white/10' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'"
          @click="emit('update:shotType', t)"
        >
          <svg viewBox="0 0 44 26" class="w-full px-1" style="height: 22px">
            <rect x="1" y="1" width="42" height="24" rx="2.5" fill="none"
                  :stroke="shotType === t ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.18)'" stroke-width="1" />
            <clipPath :id="`fr-${t}`"><rect x="1" y="1" width="42" height="24" rx="2.5" /></clipPath>
            <circle :cx="22" :cy="SHOT_GLYPH[t].cy" :r="SHOT_GLYPH[t].r" :clip-path="`url(#fr-${t})`"
                    :fill="shotType === t ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)'" />
          </svg>
          <span class="text-[9px] leading-none" :class="shotType === t ? 'text-white/80' : 'text-white/35'">{{ SHOT_LABEL[t] }}</span>
        </button>
      </div>
    </div>

    <!-- Camera move, grouped by category -->
    <div>
      <label class="mb-1.5 flex items-center justify-between text-[11px] text-white/45">
        <span>Camera move</span>
        <span class="text-[10px] text-white/25">one per shot</span>
      </label>
      <div class="space-y-2">
        <div v-for="g in MOVE_GROUPS" :key="g.cat">
          <div class="mb-1 text-[9px] uppercase tracking-wide text-white/25">{{ g.cat }}</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="m in g.moves" :key="m"
              type="button"
              :title="CAMERA_MOVE_PHRASE[m]"
              class="flex min-w-[58px] flex-1 flex-col items-center gap-1 rounded border py-1.5 transition-colors"
              :class="move === m
                ? 'border-white/35 bg-white/10 text-white/90'
                : 'border-white/10 bg-white/[0.02] text-white/40 hover:border-white/20 hover:bg-white/[0.05] hover:text-white/70'"
              @click="selectMove(m)"
            >
              <component :is="MOVE_ICON[m]" class="h-4 w-4" />
              <span class="text-[9px] leading-none">{{ CAMERA_MOVE_PHRASE[m] }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Direction (only for moves that have one) -->
    <div v-if="moveDirs.length">
      <label class="mb-1.5 block text-[11px] text-white/45">Direction</label>
      <div class="flex gap-1.5">
        <button
          v-for="dir in moveDirs" :key="dir"
          type="button"
          class="flex flex-1 items-center justify-center gap-1 rounded border py-1.5 text-[10px] transition-colors"
          :class="activeDir === dir
            ? 'border-white/35 bg-white/10 text-white/90'
            : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/70'"
          @click="emit('update:direction', dir)"
        >
          <component :is="DIR_META[dir].icon" class="h-3.5 w-3.5" />
          {{ DIR_META[dir].label }}
        </button>
      </div>
    </div>

    <!-- Pacing -->
    <div>
      <label class="mb-1.5 block text-[11px] text-white/45">Pacing</label>
      <div class="flex gap-1">
        <button
          v-for="p in PACING" :key="p"
          type="button"
          class="flex-1 rounded border py-1 text-[10px] capitalize transition-colors"
          :class="pacing === p ? 'border-white/30 bg-white/10 text-white/80' : 'border-white/10 text-white/35 hover:border-white/20 hover:text-white/60'"
          @click="emit('update:pacing', p)"
        >{{ p }}</button>
      </div>
    </div>
  </div>
</template>
