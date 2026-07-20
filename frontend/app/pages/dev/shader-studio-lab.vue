<script setup lang="ts">
// Standalone smoke harness for ShaderStudioSurface (mirrors dev/scene3d-lab).
// Mounts the surface against a stub node whose persisted config already carries a
// seeded source image (a data-URL gradient), so the modal opens with something to
// process — used to verify the Task 6 N-effect hold-FBO composite + back-compat.
// Not linked in the app.
definePageMeta({ layout: false })
import { reactive, ref } from 'vue'
import ShaderStudioSurface from '~/components/vue-canvas/ShaderStudioSurface.vue'

// A raster-friendly SVG gradient with a couple of shapes for visual interest.
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='768' height='512'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='#0b1e3f'/>
      <stop offset='0.5' stop-color='#2b7a78'/>
      <stop offset='1' stop-color='#ffd166'/>
    </linearGradient>
  </defs>
  <rect width='768' height='512' fill='url(#g)'/>
  <circle cx='250' cy='200' r='120' fill='#ff6b6b' opacity='0.75'/>
  <rect x='430' y='150' width='220' height='220' rx='24' fill='#48cae4' opacity='0.7'/>
  <text x='40' y='470' font-family='sans-serif' font-size='48' fill='#ffffff' opacity='0.85'>SHADER LAB</text>
</svg>`
const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`

const open = ref(true)
// Persisted config with a seeded source and a single default (empty) effect layer.
// The migrate/hydrate load path fills the rest of the config from defaults.
const nodes = reactive([{
  id: 'lab-1',
  type: 'shaderStudio',
  data: {
    nodeType: 'ShaderStudio',
    properties: {
      sailor_shaderStudio: {
        source: { kind: 'upload', dataUrl },
        effects: [{ layerId: 'L0', id: '', params: {}, enabled: true, customChars: '', blend: 'normal', opacity: 1 }],
      },
    },
  },
}])
</script>

<template>
  <div class="fixed inset-0 bg-neutral-950">
    <button v-if="!open" class="m-8 rounded bg-white/10 px-4 py-2 text-white" @click="open = true">Open Shader Studio</button>
    <!-- ClientOnly: the shader surface touches WebGL (document.createElement) during
         setup, which is unavailable in SSR. In the real app the surface only ever
         mounts client-side inside the canvas modal, so this is a harness-only guard. -->
    <ClientOnly>
      <ShaderStudioSurface v-if="open" node-id="lab-1" :nodes="nodes" :edges="[]" @close="open = false" />
    </ClientOnly>
  </div>
</template>
