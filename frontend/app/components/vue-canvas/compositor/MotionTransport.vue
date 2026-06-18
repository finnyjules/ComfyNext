<script setup lang="ts">
import type { FrameMotion } from '~/lib/motion/types'

defineProps<{
  motion: FrameMotion
  t: number | null
  playing: boolean
  baking?: boolean
  bakeProgress?: number
  stale?: boolean
}>()
const emit = defineEmits<{
  play: []
  pause: []
  scrub: [t: number]
  exit: []
  bake: []
  'update:motion': [patch: Partial<FrameMotion>]
}>()

function fmt(s: number) { return s.toFixed(2) + 's' }
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111111]/95 border border-white/10 text-xs text-white/70 shadow-lg">
    <button
      class="w-7 h-7 grid place-items-center rounded cursor-pointer hover:bg-white/10 text-white/85"
      :title="playing ? 'Pause' : 'Play'"
      @click="playing ? emit('pause') : emit('play')"
    >
      <span v-if="playing">❚❚</span><span v-else>▶</span>
    </button>
    <input
      type="range" class="w-48 accent-white" min="0" :max="motion.duration" step="0.01"
      :value="t ?? 0"
      @input="emit('scrub', Number(($event.target as HTMLInputElement).value))"
    >
    <span class="tabular-nums w-14">{{ fmt(t ?? 0) }}</span>
    <label class="flex items-center gap-1">dur
      <input
        type="number" min="0.5" max="60" step="0.5" :value="motion.duration"
        class="w-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="emit('update:motion', { duration: Math.max(0.5, Number(($event.target as HTMLInputElement).value) || 4) })"
      >
    </label>
    <label class="flex items-center gap-1">fps
      <input
        type="number" min="1" max="60" step="1" :value="motion.fps"
        class="w-12 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="emit('update:motion', { fps: Math.max(1, Math.min(60, Number(($event.target as HTMLInputElement).value) || 30)) })"
      >
    </label>
    <button
      class="px-2 py-0.5 rounded font-medium"
      :class="stale ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-white/15 text-white/70 hover:bg-white/20'"
      :disabled="baking"
      :title="stale ? 'Layers changed since last bake' : 'Bake motion to frames'"
      @click="emit('bake')"
    >
      {{ baking ? `Baking ${Math.round((bakeProgress ?? 0) * 100)}%` : stale ? 'Re-bake' : 'Bake' }}
    </button>
    <button class="ml-1 px-2 py-0.5 rounded cursor-pointer hover:bg-white/10 text-white/85" title="Exit motion preview" @click="emit('exit')">✕</button>
  </div>
</template>
