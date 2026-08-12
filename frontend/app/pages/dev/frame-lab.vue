<script setup lang="ts">
/** Dev harness for the Compositor MODAL — exercises the new text typography
 * controls (letter-spacing / underline / strikethrough / case transform) and
 * nested layer groups. Mounts the real CompositorModal with a fixture node.
 * Reachable only at /dev/frame-lab. */
import CompositorModal from '~/components/vue-canvas/CompositorModal.vue'
import { createTextLayer, createRectLayer, createImageLayer } from '~/composables/useCompositorLayers'

// Text layers exercising every new control.
const plain = createTextLayer({ text: 'Plain text', x: 0.5, y: 0.12, fontSize: 0.06, color: '#ffffff' })
const tracked = createTextLayer({ text: 'Wide tracking', x: 0.5, y: 0.24, fontSize: 0.06, letterSpacing: 0.3, color: '#54f4cf' })
const underlined = createTextLayer({ text: 'Underlined', x: 0.5, y: 0.36, fontSize: 0.06, underline: true, color: '#ffb984' })
const struck = createTextLayer({ text: 'Strikethrough', x: 0.5, y: 0.48, fontSize: 0.06, strikethrough: true, color: '#ff99f7' })
const upper = createTextLayer({ text: 'uppercased', x: 0.5, y: 0.60, fontSize: 0.06, textTransform: 'uppercase', color: '#0e6bff' })
const combo = createTextLayer({ text: 'all at once', x: 0.5, y: 0.72, fontSize: 0.06, textTransform: 'capitalize', underline: true, letterSpacing: 0.12, color: '#f2ff5a' })

// A local image layer — exercises the layer-list thumbnail (its own pixels) and
// double-click rename. `filename` points at a real ComfyUI input image so the
// /view thumbnail actually loads.
const pic = createImageLayer('frame_img_1786433110820_0000.png', 1.5, { x: 0.5, y: 0.5, w: 0.4, h: 0.4 / 1.5 } as any)

// Nested groups: A = [a1,a2], B = [b1] ; A and B nested under C ("Header").
const a1 = createTextLayer({ id: 'a1', text: 'Title', x: 0.3, y: 0.85, fontSize: 0.05 } as any)
const a2 = createRectLayer({ id: 'a2', x: 0.3, y: 0.9, w: 0.2, h: 0.03, fill: '#54f4cf' } as any)
const b1 = createTextLayer({ id: 'b1', text: 'Subtitle', x: 0.7, y: 0.85, fontSize: 0.04 } as any)
;(a1 as any).groupId = 'A'; (a2 as any).groupId = 'A'; (b1 as any).groupId = 'B'

// Motion fixtures: exercise in/loop/out, the window, and a utility preset.
;(plain as any).animation = {
  offset: 0.3, duration: 3,
  in: { presetId: 'slide-up', duration: 0.6, stagger: 0.03 },
  loop: { presetId: 'float', duration: 1.6, stagger: 0.04 },
  out: { presetId: 'fade-out', duration: 0.5, stagger: 0.02 },
}
;(tracked as any).animation = {
  offset: 0,
  loop: { presetId: 'wiggle', duration: 2, stagger: 0, params: { amplitude: 0.2, cycles: 2 } },
}

const node = reactive({
  id: 'n1',
  data: {
    nodeType: 'CompositorNode',
    title: 'Frame',
    inputs: [], outputs: [{ name: 'image', type: 'IMAGE', links: null }],
    widgetsValues: [], widgetDefs: [{ name: 'width' }, { name: 'height' }],
    images: [] as string[],
    properties: {
      sailor_localLayers: [pic, plain, tracked, underlined, struck, upper, combo, a1, a2, b1],
      sailor_localGroups: [
        { id: 'A', parentId: 'C', name: 'Row' },
        { id: 'B', parentId: 'C', name: 'Side' },
        { id: 'C', name: 'Header' },
      ],
      sailor_localBg: '#12131a',
    },
    mode: 0,
  },
})
// A wired image source (an Image node feeding input-0 ⇒ slot 1). Exercises the
// wired-layer thumbnail and the new wired rename (double-click "Layer 1").
const imgSrc = reactive({
  id: 'img1',
  data: {
    nodeType: 'Image',
    images: ['/view?filename=1786471194089_pasted-1786471194089.png&type=input'],
    widgetsValues: [], widgetDefs: [],
  },
})
const edges = [{ source: 'img1', target: 'n1', sourceHandle: 'output-0', targetHandle: 'input-0' }]
const nodes = [node, imgSrc]
</script>

<template>
  <div class="fixed inset-0 bg-[#0b0d12]">
    <div class="absolute inset-0 grid place-items-center text-white/[0.06] text-[80px] font-bold select-none">
      frame lab
    </div>
    <CompositorModal :node-id="'n1'" :nodes="nodes" :edges="edges" @close="() => {}" />
  </div>
</template>
