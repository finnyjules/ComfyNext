<script setup lang="ts">
/** Dev harness for the Smart Layout editor MODAL (wide-modal chrome), mounted
 * over a stand-in canvas so the backdrop + panel framing are visible. A mock
 * node with an empty 'layout' widget → opens on the format picker. Reachable
 * only at /dev/sl-modal. */
import SmartLayoutEditorModal from '~/components/vue-canvas/SmartLayoutEditorModal.vue'

const nodes = [{ id: 'n1', data: { widgetDefs: [{ name: 'layout' }], widgetsValues: [''] } }]
</script>

<template>
  <div class="fixed inset-0 bg-[#0b0d12]">
    <!-- stand-in for the canvas behind the modal -->
    <div class="absolute inset-0 grid place-items-center text-white/[0.06] text-[80px] font-bold select-none">
      canvas behind
    </div>
    <SmartLayoutEditorModal :node-id="'n1'" :nodes="nodes" :edges="[]" @close="() => {}" />
  </div>
</template>
