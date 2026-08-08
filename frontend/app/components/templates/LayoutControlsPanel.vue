<script setup lang="ts">
import { STAGINGS } from '~~/shared/template-grid/generate/stagings'
import { SURFACES } from '~~/shared/template-grid/generate/surfaces'

const ctx = inject<any>('gridEditor')
</script>

<template>
  <div class="px-4 py-3.5 flex flex-col gap-3 border-b border-white/[0.06]">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Layout</p>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Staging</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.staging ? 'text-action' : 'text-white/30'"
          title="Lock staging so Surprise only rolls the surface" @click="ctx.toggleLock('staging')">
          {{ ctx.genLocks.value.staging ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in STAGINGS" :key="s.id" :title="s.blurb"
          class="h-8 px-2 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer"
          :class="ctx.genStaging.value === s.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white'"
          @click="ctx.setStaging(s.id)">{{ s.name }}</button>
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Surface</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.surface ? 'text-action' : 'text-white/30'"
          title="Lock surface so Surprise only rolls the staging" @click="ctx.toggleLock('surface')">
          {{ ctx.genLocks.value.surface ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in SURFACES" :key="s.id" :title="s.name"
          class="h-8 px-2 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer"
          :class="ctx.genSurface.value === s.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white'"
          @click="ctx.setSurface(s.id)">{{ s.name }}</button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button class="flex-1 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 font-semibold cursor-pointer"
        @click="ctx.shuffleLayout()">Shuffle ⇄</button>
      <button class="flex-1 h-8 rounded-md bg-action hover:bg-action/90 text-[12px] text-white font-semibold cursor-pointer"
        @click="ctx.surpriseLayout()">Surprise ✦</button>
    </div>
    <p class="text-[10px] text-white/30 font-mono">seed {{ ctx.genSeed.value }}</p>
  </div>
</template>
