<script setup lang="ts">
// Standalone smoke harness for the 2D-vector ShapeStudioSurface (mirrors
// scene3d-lab.vue): mounts the surface against a stub node so the preview /
// controls / SVG export can be exercised before VueNodeCanvas wiring. The old
// 3D ShapeEngine harness this replaced was retired with lib/shapefx.
definePageMeta({ layout: false })
import { reactive } from 'vue'
import ShapeStudioSurface from '~/components/vue-canvas/ShapeStudioSurface.vue'

const nodes = reactive([{
  id: 'lab-1',
  type: 'shape-studio',
  data: { properties: { sailor_shapeStudio: undefined } },
}])
</script>

<template>
  <div class="fixed inset-0 bg-neutral-950">
    <ShapeStudioSurface node-id="lab-1" :nodes="nodes" :edges="[]" @close="() => {}" />
  </div>
</template>
