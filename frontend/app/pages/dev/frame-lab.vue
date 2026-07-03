<script setup lang="ts">
/** Dev harness for the Compositor MODAL — exercises the new text typography
 * controls (letter-spacing / underline / strikethrough / case transform) and
 * nested layer groups. Mounts the real CompositorModal with a fixture node.
 * Reachable only at /dev/frame-lab. */
import CompositorModal from '~/components/vue-canvas/CompositorModal.vue'
import { createTextLayer, createRectLayer } from '~/composables/useCompositorLayers'

// Text layers exercising every new control.
const plain = createTextLayer({ text: 'Plain text', x: 0.5, y: 0.12, fontSize: 0.06, color: '#ffffff' })
const tracked = createTextLayer({ text: 'Wide tracking', x: 0.5, y: 0.24, fontSize: 0.06, letterSpacing: 0.3, color: '#54f4cf' })
const underlined = createTextLayer({ text: 'Underlined', x: 0.5, y: 0.36, fontSize: 0.06, underline: true, color: '#ffb984' })
const struck = createTextLayer({ text: 'Strikethrough', x: 0.5, y: 0.48, fontSize: 0.06, strikethrough: true, color: '#ff99f7' })
const upper = createTextLayer({ text: 'uppercased', x: 0.5, y: 0.60, fontSize: 0.06, textTransform: 'uppercase', color: '#0e6bff' })
const combo = createTextLayer({ text: 'all at once', x: 0.5, y: 0.72, fontSize: 0.06, textTransform: 'capitalize', underline: true, letterSpacing: 0.12, color: '#f2ff5a' })

// Nested groups: A = [a1,a2], B = [b1] ; A and B nested under C ("Header").
const a1 = createTextLayer({ id: 'a1', text: 'Title', x: 0.3, y: 0.85, fontSize: 0.05 } as any)
const a2 = createRectLayer({ id: 'a2', x: 0.3, y: 0.9, w: 0.2, h: 0.03, fill: '#54f4cf' } as any)
const b1 = createTextLayer({ id: 'b1', text: 'Subtitle', x: 0.7, y: 0.85, fontSize: 0.04 } as any)
;(a1 as any).groupId = 'A'; (a2 as any).groupId = 'A'; (b1 as any).groupId = 'B'

const node = reactive({
  id: 'n1',
  data: {
    nodeType: 'CompositorNode',
    title: 'Frame',
    inputs: [], outputs: [{ name: 'image', type: 'IMAGE', links: null }],
    widgetsValues: [], widgetDefs: [{ name: 'width' }, { name: 'height' }],
    images: [] as string[],
    properties: {
      comfynext_localLayers: [plain, tracked, underlined, struck, upper, combo, a1, a2, b1],
      comfynext_localGroups: [
        { id: 'A', parentId: 'C', name: 'Row' },
        { id: 'B', parentId: 'C', name: 'Side' },
        { id: 'C', name: 'Header' },
      ],
      comfynext_localBg: '#12131a',
    },
    mode: 0,
  },
})
const nodes = [node]
</script>

<template>
  <div class="fixed inset-0 bg-[#0b0d12]">
    <div class="absolute inset-0 grid place-items-center text-white/[0.06] text-[80px] font-bold select-none">
      frame lab
    </div>
    <CompositorModal :node-id="'n1'" :nodes="nodes" :edges="[]" @close="() => {}" />
  </div>
</template>
