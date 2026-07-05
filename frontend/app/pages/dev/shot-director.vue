<script setup lang="ts">
// Dev harness for the Shot Director editor surface — renders the modal in
// isolation with a seeded sheet so the viewfinder + visual camera controls can
// be inspected without wiring up a full canvas + ComfyUI backend. Not shipped UI.
import { reactive, ref } from 'vue'
import ShotDirectorSurface from '~/components/vue-canvas/ShotDirectorSurface.vue'

const portraitSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='520'>
  <rect width='320' height='520' fill='rgb(46,42,48)'/>
  <rect x='0' y='300' width='320' height='220' fill='rgb(170,58,44)'/>
  <path d='M60 520 Q160 320 260 520 Z' fill='rgb(198,74,58)'/>
  <circle cx='160' cy='210' r='78' fill='rgb(214,176,150)'/>
  <path d='M92 200 Q100 96 160 96 Q220 96 228 200 Q210 150 160 150 Q110 150 92 200 Z' fill='rgb(38,28,26)'/>
</svg>`
const portrait = 'data:image/svg+xml,' + encodeURIComponent(portraitSvg)

const seededSheet = {
  intent: '',
  mode: 'reference',
  subject: 'A woman in a red coat',
  action: 'walks slowly toward camera',
  environment: 'rainy street, neon signs',
  lighting: 'neon',
  style: 'cinematic, 35mm film grain',
  camera: { shotType: 'medium', move: 'push-in', pacing: 'smooth' },
  constraints: ['no camera shake'],
  cast: [],
  references: [{ kind: 'image', slot: 1, src: portrait, role: 'identity-lock' }],
  beats: [],
  audio: { generate: true },
  format: { aspectRatio: '16:9', durationS: 5, resolution: '1080p' },
}

const nodes = reactive([
  { id: 'harness-1', data: { nodeType: 'ShotDirector', properties: { comfynext_shotDirector: seededSheet } } },
])
const open = ref(true)
</script>

<template>
  <div class="min-h-screen bg-neutral-950">
    <ShotDirectorSurface v-if="open" :node-id="'harness-1'" :nodes="nodes" @close="open = false" />
    <button v-else class="m-6 rounded bg-white/10 px-3 py-2 text-white" @click="open = true">Reopen</button>
  </div>
</template>
