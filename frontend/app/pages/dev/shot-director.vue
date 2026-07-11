<script setup lang="ts">
// Dev harness for the Shot Director editor surface — renders the modal in
// isolation with a seeded sheet so the viewfinder + visual camera controls can
// be inspected without wiring up a full canvas + ComfyUI backend. Not shipped UI.
import { reactive, ref } from 'vue'
import ShotDirectorSurface from '~/components/vue-canvas/ShotDirectorSurface.vue'
import ShotViewfinder from '~/components/vue-canvas/ShotViewfinder.vue'

const portraitSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='520'>
  <rect width='320' height='520' fill='rgb(46,42,48)'/>
  <rect x='0' y='300' width='320' height='220' fill='rgb(170,58,44)'/>
  <path d='M60 520 Q160 320 260 520 Z' fill='rgb(198,74,58)'/>
  <circle cx='160' cy='210' r='78' fill='rgb(214,176,150)'/>
  <path d='M92 200 Q100 96 160 96 Q220 96 228 200 Q210 150 160 150 Q110 150 92 200 Z' fill='rgb(38,28,26)'/>
</svg>`
const portrait = 'data:image/svg+xml,' + encodeURIComponent(portraitSvg)

const plateSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'>
  <rect width='480' height='270' fill='rgb(18,20,34)'/>
  <rect y='180' width='480' height='90' fill='rgb(30,26,40)'/>
  <rect x='40' y='60' width='30' height='140' fill='rgb(40,44,70)'/>
  <rect x='120' y='40' width='24' height='160' fill='rgb(46,40,64)'/>
  <rect x='330' y='70' width='34' height='130' fill='rgb(38,42,66)'/>
  <rect x='210' y='90' width='60' height='16' fill='rgb(255,80,140)' opacity='0.8'/>
  <rect x='90' y='120' width='40' height='12' fill='rgb(80,200,255)' opacity='0.8'/>
  <rect x='360' y='110' width='46' height='14' fill='rgb(120,255,180)' opacity='0.7'/>
</svg>`
const plate = 'data:image/svg+xml,' + encodeURIComponent(plateSvg)

const seededSheet = {
  intent: '',
  mode: 'reference',
  subject: 'A woman in a red coat',
  action: 'walks slowly toward camera',
  environment: 'rainy street, neon signs',
  lighting: 'neon',
  style: 'cinematic, 35mm film grain',
  camera: { shotType: 'medium', move: 'orbit', pacing: 'smooth', direction: 'ccw' },
  constraints: ['no camera shake'],
  cast: [{ slug: 'vera', name: 'Vera', via: 'picker' }],
  references: [
    { kind: 'image', slot: 1, src: portrait, role: 'identity-lock' },
    { kind: 'image', slot: 2, src: plate, role: 'location' },
  ],
  beats: [],
  audio: { generate: true },
  format: { aspectRatio: '16:9', durationS: 5, resolution: '1080p' },
}

const nodes = reactive([
  { id: 'harness-1', data: { nodeType: 'ShotDirector', properties: { sailor_shotDirector: seededSheet } } },
])
const open = ref(true)
</script>

<template>
  <div class="min-h-screen bg-neutral-950 p-6">
    <ShotDirectorSurface v-if="open" :node-id="'harness-1'" :nodes="nodes" @close="open = false" />
    <template v-else>
      <button class="mb-6 rounded bg-white/10 px-3 py-2 text-white" @click="open = true">Reopen</button>
      <!-- Standalone viewfinder to inspect keyframe rendering + stale chip -->
      <div class="text-white">
        <p class="mb-2 text-xs text-white/50">Viewfinder with a generated keyframe (stale):</p>
        <ShotViewfinder
          aspect-ratio="16:9" duration-label="5s" shot-type="medium" move="push-in" mode="reference"
          :subject-image="portrait" subject-label="Vera" :environment-image="plate"
          :keyframe="plate" :keyframe-stale="true"
        />
      </div>
    </template>
  </div>
</template>
