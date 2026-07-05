<script setup lang="ts">
// Dev harness: mount the real GradientStudioSurface to check the palette picker
// in its Color section. Not linked in the app.
definePageMeta({ layout: false })
import { reactive } from 'vue'
import GradientStudioSurface from '~/components/vue-canvas/GradientStudioSurface.vue'

const nodeId = 'mock-gradient-1'
const nodes = reactive([
  { id: nodeId, type: 'gradient-studio', data: { nodeType: 'GradientStudio', properties: {} } },
])
</script>

<template>
  <div class="fixed inset-0 bg-black">
    <GradientStudioSurface :node-id="nodeId" :nodes="nodes" @close="() => {}" />
  </div>
</template>
