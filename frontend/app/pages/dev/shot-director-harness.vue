<script setup lang="ts">
definePageMeta({ layout: false })
import { reactive } from 'vue'
import ShotDirectorSurface from '~/components/vue-canvas/ShotDirectorSurface.vue'
const nodeId = 'mock-shot-1'
const nodes = reactive([{ id: nodeId, type: 'shot-director', data: { nodeType: 'ShotDirector', properties: { sailor_shotDirector: {} } } }])
</script>

<template>
  <div class="fixed inset-0 bg-black">
    <ShotDirectorSurface :node-id="nodeId" :nodes="nodes" @close="() => {}" />
  </div>
</template>
