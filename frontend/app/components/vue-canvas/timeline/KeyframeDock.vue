<script setup lang="ts">
import { computed } from 'vue'
import { useTimelineStore } from '~/composables/useTimelineStore'
import { VARIABLE_FONTS } from '~/data/variable-fonts'
import type { MotionClip } from '~~/shared/timeline/types'

const props = defineProps<{ pxPerFrame: number; scrollX: number }>()
const store = useTimelineStore()

function framesToPx(frame: number): number { return frame * props.pxPerFrame - props.scrollX }

const clip = computed<MotionClip | null>(() => {
  const c = store.selectedClip.value
  return c && c.kind === 'motion' ? (c as MotionClip) : null
})

const axes = computed(() => {
  const f = clip.value && VARIABLE_FONTS.find(v => v.family === clip.value!.layer.fontFamily)
  return f ? f.axes : []
})

const transformKfs = computed(() => clip.value?.keyframes ?? [])
function axisKfsFor(tag: string) {
  const c = clip.value
  if (!c) return []
  return (c.layer.axisKeyframes ?? []).filter(k => tag in k.axes)
}
function tToFrame(t: number): number { return (clip.value?.start_frame ?? 0) + t * (clip.value?.length ?? 1) }
</script>

<template>
  <div v-if="clip" class="border-t border-white/10 bg-[#141416] flex flex-col" style="height: 150px">
    <div class="flex items-center gap-2 px-3 h-7 border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-white/40 shrink-0">
      ◆ Keyframes — {{ clip.layer.text || 'Motion' }}
    </div>
    <div class="flex-1 overflow-y-auto">
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Transform</div>
      <div class="relative h-5 mx-3 border-b border-white/5">
        <div class="absolute left-0 top-1.5 w-20 text-[10px] text-white/55">Transform</div>
        <div class="absolute left-24 right-3 top-2.5 h-px bg-white/10" />
        <div
          v-for="kf in transformKfs" :key="`tf-${kf.frame}`"
          class="absolute top-1.5 size-2 rotate-45 bg-violet-100 border border-black/50 -translate-x-1/2"
          :style="{ left: framesToPx(clip.start_frame + kf.frame) + 'px' }"
        />
      </div>
      <div class="px-3 pt-1.5 text-[9px] uppercase tracking-[0.08em] text-white/35">Axes</div>
      <div v-for="ax in axes" :key="ax.tag" class="relative h-5 mx-3 border-b border-white/5">
        <div class="absolute left-0 top-1.5 w-20 text-[10px] text-white/55">{{ ax.label }}</div>
        <div class="absolute left-24 right-3 top-2.5 h-px bg-white/10" />
        <div
          v-for="kf in axisKfsFor(ax.tag)" :key="`${ax.tag}-${kf.t}`"
          class="absolute top-1.5 size-2 rotate-45 bg-emerald-200 border border-black/50 -translate-x-1/2"
          :style="{ left: framesToPx(tToFrame(kf.t)) + 'px' }"
        />
      </div>
    </div>
  </div>
</template>
