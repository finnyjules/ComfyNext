<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { VARIABLE_FONTS } from '~/data/variable-fonts'
import { interpolateAxes } from '~/lib/motion/axes'
import type { MotionClip } from '~~/shared/timeline/types'

const props = defineProps<{ pxPerFrame: number; scrollX: number }>()
const store = useTimelineStore()

// Same mapping as the timeline strip so the dock aligns to the ruler/playhead.
function framesToPx(frame: number): number { return frame * props.pxPerFrame - props.scrollX }

const clip = computed<MotionClip | null>(() => {
  const c = store.selectedClip.value
  return c && c.kind === 'motion' ? (c as MotionClip) : null
})

// Font axes for this clip's font (the Axes group).
const axes = computed(() => {
  const f = clip.value && VARIABLE_FONTS.find(v => v.family === clip.value!.layer.fontFamily)
  return f ? f.axes : []
})

// Transform-lane diamonds: clip-local frame → timeline-global px.
const transformKfs = computed(() => clip.value?.keyframes ?? [])
// Axis-lane diamonds: normalized t → clip-local frame → px.
function axisKfsFor(tag: string) {
  const c = clip.value
  if (!c) return []
  return (c.layer.axisKeyframes ?? []).filter(k => tag in k.axes)
}
function tToFrame(t: number): number { return (clip.value?.start_frame ?? 0) + t * (clip.value?.length ?? 1) }

// ---- Playhead helpers ----
function localPlayhead(): number {
  const c = clip.value!
  return Math.max(0, Math.min(store.playheadFrame.value - c.start_frame, c.length - 1))
}
function playheadT(): number {
  const c = clip.value!
  return c.length > 0 ? localPlayhead() / c.length : 0
}

// ---- Transform lane ----
function transformKfAtPlayhead() { return transformKfs.value.find(k => k.frame === localPlayhead()) }
function toggleTransformKf() {
  const c = clip.value!
  const k = transformKfAtPlayhead()
  if (k) store.removeKeyframeAt(c.id, k.frame)
  else store.addKeyframe(c.id)   // captures current transform at playhead (existing 2a behaviour)
}

// ---- Axis lanes ----
function axisKfAtPlayhead(tag: string) {
  const t = playheadT()
  return (clip.value?.layer.axisKeyframes ?? []).find(k => Math.abs(k.t - t) < 1e-4 && tag in k.axes)
}
function toggleAxisKf(tag: string, axDefault: number) {
  const c = clip.value!
  const t = playheadT()
  const existing = axisKfAtPlayhead(tag)
  if (existing) {
    // remove just this axis from the keyframe; drop the keyframe if it becomes empty
    const remaining = { ...existing.axes }
    delete remaining[tag]
    if (Object.keys(remaining).length) store.setAxisKeyframeAxes(c.id, existing.t, remaining)
    else store.removeAxisKeyframeAt(c.id, existing.t)
  } else {
    // capture the current interpolated value for this axis so toggling on doesn't jump
    const cur = interpolateAxes((c.layer.axisKeyframes ?? []) as any, t, c.layer.axes ?? {})
    store.addAxisKeyframe(c.id, t, { [tag]: cur[tag] ?? c.layer.axes?.[tag] ?? axDefault })
  }
}

// ---- Nav ----
function seekToFrame(localFrame: number) { store.seekFrame(clip.value!.start_frame + localFrame) }
function navTransform(dir: 1 | -1) {
  const cur = localPlayhead()
  const frames = transformKfs.value.map(k => k.frame).sort((a, b) => a - b)
  const next = dir > 0 ? frames.find(f => f > cur) : [...frames].reverse().find(f => f < cur)
  if (next !== undefined) seekToFrame(next)
}
function navAxis(tag: string, dir: 1 | -1) {
  const cur = playheadT()
  const ts = axisKfsFor(tag).map(k => k.t).sort((a, b) => a - b)
  const next = dir > 0 ? ts.find(t => t > cur + 1e-4) : [...ts].reverse().find(t => t < cur - 1e-4)
  if (next !== undefined) seekToFrame(Math.round(next * clip.value!.length))
}

// ---- Drag-to-retime ----
type Drag =
  | { kind: 'transform'; fromFrame: number; startX: number; startFrame: number }
  | { kind: 'axis'; tag: string; fromT: number; startX: number; startFrame: number }
const drag = ref<Drag | null>(null)

function onTransformDown(frame: number, e: PointerEvent) {
  e.stopPropagation()
  drag.value = { kind: 'transform', fromFrame: frame, startX: e.clientX, startFrame: frame }
}
function onAxisDown(tag: string, t: number, e: PointerEvent) {
  e.stopPropagation()
  drag.value = { kind: 'axis', tag, fromT: t, startX: e.clientX, startFrame: Math.round(t * clip.value!.length) }
}
function onMove(e: PointerEvent) {
  const d = drag.value, c = clip.value
  if (!d || !c) return
  const dframes = Math.round((e.clientX - d.startX) / props.pxPerFrame)
  if (d.kind === 'transform') {
    const target = Math.max(0, Math.min(d.startFrame + dframes, c.length - 1))
    if (target !== d.fromFrame && !c.keyframes?.some(k => k.frame === target)) {
      store.moveKeyframe(c.id, d.fromFrame, target)
      d.fromFrame = target
      store.seekFrame(c.start_frame + target)
    }
  } else {
    const targetFrame = Math.max(0, Math.min(d.startFrame + dframes, c.length - 1))
    const targetT = c.length > 0 ? targetFrame / c.length : 0
    if (Math.abs(targetT - d.fromT) > 1e-4 && !(c.layer.axisKeyframes ?? []).some(k => Math.abs(k.t - targetT) < 1e-4)) {
      store.moveAxisKeyframe(c.id, d.fromT, targetT)
      d.fromT = targetT
      store.seekFrame(c.start_frame + targetFrame)
    }
  }
}
function onUp() { drag.value = null }
onMounted(() => { window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp) })
onBeforeUnmount(() => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) })
</script>

<template>
  <div v-if="clip" class="border-t border-white/10 bg-[#141416] flex flex-col" style="height: 150px">
    <div class="flex items-center gap-2 px-3 h-7 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-white/40 shrink-0">
      ◆ Keyframes — {{ clip.layer.text || 'Motion' }}
    </div>
    <div class="flex-1 overflow-y-auto">
      <!-- Transform group (single lane: keyframes are 5-tuple snapshots) -->
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Transform</div>
      <!-- Lane height h-6 gives a bit more room for the cluster buttons -->
      <div class="relative h-6 mx-3 border-b border-white/5">
        <!-- Control cluster: ◀ ◆-toggle ▶ + label; occupies left-0 → left-32 (~128px) -->
        <div class="absolute left-0 top-0.5 flex items-center gap-1">
          <button class="text-white/40 hover:text-white text-[10px] px-0.5" @click="navTransform(-1)">◀</button>
          <button
            class="size-2.5 rotate-45 border"
            :class="transformKfAtPlayhead() ? 'bg-yellow-300 border-yellow-500' : 'border-white/40 hover:border-white'"
            @click="toggleTransformKf()"
          />
          <button class="text-white/40 hover:text-white text-[10px] px-0.5" @click="navTransform(1)">▶</button>
          <span class="text-[10px] text-white/55 ml-1">Transform</span>
        </div>
        <!-- Track line starts at left-32 (same offset as cluster width) -->
        <div class="absolute left-32 right-3 top-3 h-px bg-white/10" />
        <div
          v-for="kf in transformKfs" :key="`tf-${kf.frame}`"
          class="absolute top-1.5 size-2 rotate-45 bg-violet-100 border border-black/50 -translate-x-1/2 cursor-grab"
          :style="{ left: framesToPx(clip.start_frame + kf.frame) + 'px' }"
          @pointerdown.stop="(e) => onTransformDown(kf.frame, e)"
        />
      </div>
      <!-- Axes group (one lane per font axis) -->
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Axes</div>
      <div v-for="ax in axes" :key="ax.tag" class="relative h-6 mx-3 border-b border-white/5">
        <!-- Control cluster for this axis lane -->
        <div class="absolute left-0 top-0.5 flex items-center gap-1">
          <button class="text-white/40 hover:text-white text-[10px] px-0.5" @click="navAxis(ax.tag, -1)">◀</button>
          <button
            class="size-2.5 rotate-45 border"
            :class="axisKfAtPlayhead(ax.tag) ? 'bg-yellow-300 border-yellow-500' : 'border-white/40 hover:border-white'"
            @click="toggleAxisKf(ax.tag, ax.default)"
          />
          <button class="text-white/40 hover:text-white text-[10px] px-0.5" @click="navAxis(ax.tag, 1)">▶</button>
          <span class="text-[10px] text-white/55 ml-1">{{ ax.label }}</span>
        </div>
        <!-- Track line starts at left-32 to clear the cluster -->
        <div class="absolute left-32 right-3 top-3 h-px bg-white/10" />
        <div
          v-for="kf in axisKfsFor(ax.tag)" :key="`${ax.tag}-${kf.t}`"
          class="absolute top-1.5 size-2 rotate-45 bg-emerald-200 border border-black/50 -translate-x-1/2 cursor-grab"
          :style="{ left: framesToPx(tToFrame(kf.t)) + 'px' }"
          @pointerdown.stop="(e) => { onAxisDown(ax.tag, kf.t, e); store.selectedClipId.value = clip!.id; store.selectedAxisKeyframeT.value = kf.t }"
        />
      </div>
    </div>
  </div>
</template>
