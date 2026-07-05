<script setup lang="ts">
// Shot Director — viewfinder. The visual hero of the editor: composes the shot
// from real sheet imagery (cast photos, references, or first/last frames) into an
// aspect-ratio-correct frame with rule-of-thirds guides, a framing-scale that
// reflects the shot type, and a camera-move motif. Purely presentational — it
// reads the sheet, it never mutates it.
import { computed } from 'vue'
import { SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, type ShotType, type CameraMove, type ShotMode } from '~/lib/shotdirector/types'

const props = defineProps<{
  aspectRatio: string
  durationLabel: string
  shotType: ShotType
  move: CameraMove
  mode: ShotMode
  subjectImage: string | null
  subjectLabel: string
  environmentImage?: string | null
  firstFrame?: string
  lastFrame?: string
}>()

// Fit the frame inside the panel while keeping true aspect ratio, so portrait
// (9:16) and ultra-wide (21:9) both letterbox cleanly instead of overflowing.
const MAX_W = 348
const MAX_H = 240
const box = computed(() => {
  const [w, h] = props.aspectRatio.split(':').map(Number)
  const rw = w || 16
  const rh = h || 9
  let W = MAX_W
  let H = (W * rh) / rw
  if (H > MAX_H) { H = MAX_H; W = (H * rw) / rh }
  return { width: `${Math.round(W)}px`, height: `${Math.round(H)}px` }
})

// Framing scale: how much of the frame the subject fills, per shot type. This is
// the whole point — "wide" and "extreme close-up" should look different at a glance.
const SUBJECT_HEIGHT: Record<ShotType, number> = {
  'establishing': 0.32,
  'wide': 0.58,
  'medium': 0.82,
  'close-up': 1.2,
  'extreme-close-up': 2.0,
}
const subjectStyle = computed(() => {
  const hFrac = SUBJECT_HEIGHT[props.shotType] ?? 0.8
  const H = Math.round(parseFloat(box.value.height) * hFrac)
  const W = Math.round(H * 0.6)
  // Tighter shots crop toward the face (top); wider shots show the whole figure.
  const objY = props.shotType === 'extreme-close-up' ? '12%'
    : props.shotType === 'close-up' ? '18%' : '28%'
  return {
    width: `${W}px`,
    height: `${H}px`,
    objectPosition: `center ${objY}`,
  }
})

// Camera-move motif — a small vocabulary of directional glyphs drawn over the frame.
type MoveKind = 'in' | 'out' | 'horizontal' | 'track' | 'orbit' | 'down' | 'wave' | 'static'
const MOVE_KIND: Record<CameraMove, MoveKind> = {
  'push-in': 'in',
  'pull-out': 'out',
  'pan': 'horizontal',
  'track': 'track',
  'orbit': 'orbit',
  'aerial': 'down',
  'handheld': 'wave',
  'locked-off': 'static',
}
const moveKind = computed(() => MOVE_KIND[props.move] ?? 'static')

const shotLabel = computed(() => SHOT_TYPE_PHRASE[props.shotType] ?? props.shotType)
const moveLabel = computed(() => CAMERA_MOVE_PHRASE[props.move] ?? props.move)
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <div
      class="relative overflow-hidden rounded-lg border border-white/[0.14] bg-[#080809]"
      :style="box"
    >
      <!-- FIRST / LAST FRAME: a two-panel mini storyboard -->
      <template v-if="mode === 'firstLastFrame'">
        <div class="absolute inset-0 flex">
          <div class="relative flex-1 overflow-hidden bg-black/40">
            <img v-if="firstFrame" :src="firstFrame" class="absolute inset-0 h-full w-full object-cover" alt="" />
            <span v-else class="absolute inset-0 flex items-center justify-center text-[10px] text-white/25">First frame</span>
            <span class="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/60">First</span>
          </div>
          <div class="w-px bg-white/15" />
          <div class="relative flex-1 overflow-hidden bg-black/40">
            <img v-if="lastFrame" :src="lastFrame" class="absolute inset-0 h-full w-full object-cover" alt="" />
            <span v-else class="absolute inset-0 flex items-center justify-center text-[10px] text-white/25">Last frame</span>
            <span class="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/60">Last</span>
          </div>
        </div>
        <!-- interpolation arrow -->
        <svg class="pointer-events-none absolute left-1/2 top-1/2 h-5 w-9 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 36 20" fill="none">
          <circle cx="18" cy="10" r="9.5" fill="#080809" stroke="rgba(255,255,255,0.25)" />
          <path d="M13 10 H22 M19 7 L23 10 L19 13" stroke="rgba(255,255,255,0.75)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </template>

      <!-- REFERENCE: composed subject in-frame -->
      <template v-else>
        <!-- environment plate — the location backdrop, darkened so the subject reads -->
        <template v-if="environmentImage">
          <img :src="environmentImage" class="absolute inset-0 h-full w-full object-cover" alt="" />
          <div class="absolute inset-0 bg-black/30" />
        </template>

        <!-- rule-of-thirds guides -->
        <svg class="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="rgba(255,255,255,0.07)" stroke-width="0.4" />
          <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="rgba(255,255,255,0.07)" stroke-width="0.4" />
          <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="rgba(255,255,255,0.07)" stroke-width="0.4" />
          <line x1="0" y1="66.6" x2="100" y2="66.6" stroke="rgba(255,255,255,0.07)" stroke-width="0.4" />
        </svg>

        <!-- subject, framed on the right third, scaled by shot type -->
        <div v-if="subjectImage" class="absolute bottom-0 left-[63%] -translate-x-1/2 overflow-hidden rounded-t-sm">
          <img :src="subjectImage" :style="subjectStyle" class="object-cover" alt="" />
        </div>
        <div v-else-if="!environmentImage" class="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          <span class="text-[11px] text-white/40">Your shot appears here</span>
          <span class="text-[10px] leading-relaxed text-white/25">Cast a character or add a reference photo — framing and camera move preview live.</span>
        </div>

        <!-- camera-move motif overlay -->
        <svg v-if="subjectImage" class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet">
          <g stroke="rgba(255,255,255,0.6)" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <template v-if="moveKind === 'in'">
              <path d="M34 20 h6 M34 20 v6 M66 20 h-6 M66 20 v6 M34 40 h6 M34 40 v-6 M66 40 h-6 M66 40 v-6" />
              <path d="M45 30 h4 M47 28 l3 2 l-3 2" opacity="0.9" />
            </template>
            <template v-else-if="moveKind === 'out'">
              <path d="M40 24 h-6 M34 24 v6 M60 24 h6 M66 24 v6 M40 36 h-6 M34 36 v-6 M60 36 h6 M66 36 v-6" />
            </template>
            <template v-else-if="moveKind === 'horizontal'">
              <path d="M30 30 H70 M64 26 l5 4 l-5 4" />
            </template>
            <template v-else-if="moveKind === 'track'">
              <path d="M28 26 H68 M63 22 l5 4 l-5 4" />
              <path d="M28 36 H68 M63 32 l5 4 l-5 4" opacity="0.55" />
            </template>
            <template v-else-if="moveKind === 'orbit'">
              <path d="M35 34 a18 10 0 1 1 30 0" />
              <path d="M61 30 l4 4 l-4 3" />
            </template>
            <template v-else-if="moveKind === 'down'">
              <path d="M50 18 V40 M46 34 l4 5 l4 -5" />
            </template>
            <template v-else-if="moveKind === 'wave'">
              <path d="M32 30 q4 -6 8 0 t8 0 t8 0 t8 0" />
            </template>
            <template v-else>
              <rect x="45" y="25" width="10" height="9" rx="1.5" />
              <path d="M47 25 v-2 a3 3 0 0 1 6 0 v2" />
            </template>
          </g>
        </svg>
      </template>

      <!-- corner labels -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
        <span class="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
          {{ shotLabel }} <span class="text-white/45">· {{ moveLabel }}</span>
        </span>
      </div>
      <div class="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5">
        <span class="rounded bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white/60">{{ aspectRatio }}</span>
        <span class="rounded bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white/60">{{ durationLabel }}</span>
      </div>
      <div v-if="subjectImage && mode !== 'firstLastFrame'" class="pointer-events-none absolute left-2 top-2">
        <span class="rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/70">{{ subjectLabel }}</span>
      </div>
    </div>
  </div>
</template>
