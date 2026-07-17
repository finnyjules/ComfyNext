<script setup lang="ts">
// Standalone smoke harness for Scene3DStudioSurface (ShapeStudio/Gradient dev-lab
// pattern): mounts the surface against a stub node so viewport/gizmo/bake can be
// exercised before VueNodeCanvas wiring. Bake uploads still hit the real ComfyUI
// server. Not linked in the app.
definePageMeta({ layout: false })
import { reactive, ref } from 'vue'
import Scene3DStudioSurface from '~/components/vue-canvas/Scene3DStudioSurface.vue'

const open = ref(true)
const widgetNames = ['scene_state', 'beauty_image', 'depth_image', 'normal_image', 'glb_url']
const nodes = reactive([{
  id: 'lab-1',
  type: 'scene3d-studio',
  data: {
    nodeType: 'Scene3DStudio',
    widgetDefs: widgetNames.map((name) => ({ name })),
    widgetsValues: ['', '', '', '', ''],
    inputs: [{ name: 'glb_url', type: 'STRING', link: null }],
  },
}])
</script>

<template>
  <div class="fixed inset-0 bg-neutral-950">
    <button v-if="!open" class="m-8 rounded bg-white/10 px-4 py-2 text-white" @click="open = true">Open 3D Studio</button>
    <Scene3DStudioSurface v-if="open" node-id="lab-1" :nodes="nodes" :edges="[]" @close="open = false" />
    <pre class="fixed bottom-2 left-2 z-[60] max-w-md whitespace-pre-wrap break-all text-[10px] text-white/40">{{ nodes[0]!.data.widgetsValues }}</pre>
  </div>
</template>
