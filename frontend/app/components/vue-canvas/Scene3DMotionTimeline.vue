<script setup lang="ts">
import { computed } from 'vue'
import type { SceneObject } from '~/lib/scene3d/config'
import type { SceneDoc } from '~/lib/scene3d/config'
import { bandSegments, resizeTransition, setClipOffset, snapSeconds } from '~/lib/scene3d/motion/timeline'

const props = defineProps<{ doc: SceneDoc; selectedId: string | null; playhead: number }>()
const emit = defineEmits<{ (e: 'select', id: string): void }>()

const duration = computed(() => props.doc.motion.duration)
// Lights carry no motion. Neither do decals: a decal is a projection baked into
// its target's surface — it rides the target's own motion and has no
// independent transform to animate (the engine pins its root to identity), so a
// timeline row for one would edit a clip nothing ever plays.
const rows = computed(() => props.doc.objects.filter(o => o.kind !== 'light' && o.kind !== 'decal'))
const pct = (f: number) => `${(f * 100).toFixed(3)}%`

function seg(o: SceneObject) { return bandSegments(o.motion, duration.value) }

// Drag a divider ('in' | 'out') or the whole clip ('offset'); dx in px over a `trackW`px track.
function startDrag(e: PointerEvent, o: SceneObject, mode: 'in' | 'out' | 'offset') {
  if (!o.motion) return
  const track = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null
  if (!track) return
  const trackW = track.clientWidth
  const startX = e.clientX
  const base = o.motion
  const startInner = mode === 'in' ? (base.in?.duration ?? 0) : mode === 'out' ? (base.out?.duration ?? 0) : (base.offset ?? 0)
  const snapTargets = [0, duration.value, duration.value / 2]
  const move = (ev: PointerEvent) => {
    const ds = ((ev.clientX - startX) / trackW) * duration.value
    let next = startInner + (mode === 'out' ? -ds : ds) // out grows leftward
    next = snapSeconds(next, snapTargets)
    if (mode === 'offset') setClipOffset(base, next, duration.value)
    else resizeTransition(base, mode, next, duration.value)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="relative flex flex-col gap-1" data-track>
      <div v-for="o in rows" :key="o.id"
           class="grid grid-cols-[80px_1fr] items-center gap-2"
           @click="emit('select', o.id)">
        <span class="truncate text-[11px]" :class="o.id === selectedId ? 'text-white' : 'text-white/50'">{{ o.name }}</span>
        <div class="relative h-5 overflow-hidden rounded border border-white/10 bg-white/[0.03]">
          <template v-if="o.motion">
            <div class="absolute inset-y-0" :style="{ left: '0', width: pct(seg(o).offsetFrac) }"></div>
            <div v-if="o.motion.in" class="absolute inset-y-0 cursor-ew-resize bg-amber-400/70"
                 :style="{ left: pct(seg(o).offsetFrac), width: pct(seg(o).inFrac) }"></div>
            <div class="absolute inset-y-0 bg-emerald-400/60"
                 :style="{ left: pct(seg(o).offsetFrac + seg(o).inFrac), right: pct(seg(o).outFrac) }"></div>
            <div v-if="o.motion.out" class="absolute inset-y-0 cursor-ew-resize bg-amber-400/70"
                 :style="{ right: '0', width: pct(seg(o).outFrac) }"></div>
            <!-- divider handles -->
            <div v-if="o.motion.in" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize"
                 :style="{ left: pct(seg(o).offsetFrac + seg(o).inFrac) }"
                 @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, o, 'in')"></div>
            <div v-if="o.motion.out" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize"
                 :style="{ left: pct(1 - seg(o).outFrac) }"
                 @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, o, 'out')"></div>
            <div class="absolute inset-y-0 w-2 cursor-grab"
                 :style="{ left: pct(seg(o).offsetFrac) }"
                 @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, o, 'offset')"></div>
          </template>
        </div>
      </div>
      <!-- playhead -->
      <div class="pointer-events-none absolute inset-y-0 w-px bg-white"
           :style="{ left: `calc(80px + 8px + ${duration ? props.playhead / duration : 0} * (100% - 88px))` }"></div>
    </div>
  </div>
</template>
