/**
 * Keeps Vue Flow's cached handle geometry in step with a node's real layout.
 *
 * Vue Flow measures each node's `handleBounds` once and reuses them to place
 * every edge endpoint. Nothing in this app ever invalidated that cache, so a
 * node that changed height after mount kept its wires pinned to where its ports
 * used to be.
 *
 * That was survivable while ports sat at a fixed offset below the node's top —
 * only content above a port moved it. Now that the port stack is centred on the
 * node's midpoint, ANY height change moves every port: a collapsing preview, a
 * widget group folding, a dynamic-grow node gaining an input. So the refresh is
 * no longer optional.
 *
 * Call once per node component, passing a ref to its outermost element.
 */
import { useNodeId, useVueFlow } from '@vue-flow/core'

export function useNodePortSync(el: Ref<HTMLElement | null>) {
  const nodeId = useNodeId()
  const { updateNodeInternals } = useVueFlow()

  let sizeObserver: ResizeObserver | null = null
  let domObserver: MutationObserver | null = null
  let queued = false

  /**
   * Re-measure AFTER Vue has patched the DOM and the browser has laid it out.
   *
   * A ResizeObserver fires as soon as the node's box changes, which is one
   * layout generation too early: the node grows because a port was added, but
   * the surviving ports' recomputed `top` values haven't been written yet. Since
   * the stack is centred, adding a port shifts every existing port — measuring
   * at that moment cached each handle at its neighbour's position and drew every
   * edge one port too low. `nextTick` waits for the patch, the frame callback
   * waits for the layout.
   */
  function scheduleRefresh() {
    if (!nodeId || queued) return
    queued = true
    nextTick(() => {
      requestAnimationFrame(() => {
        queued = false
        updateNodeInternals([nodeId])
      })
    })
  }

  onMounted(() => {
    if (!nodeId) return

    scheduleRefresh()
    if (!el.value) return

    // Size alone is not enough. A node can keep its box and still move its
    // ports — the Timeline re-spaces its inputs when a clip connects without
    // changing height, and a centred stack shifts every port whenever the count
    // changes. Watch the handles themselves as well as the box.
    if (typeof ResizeObserver !== 'undefined') {
      sizeObserver = new ResizeObserver(scheduleRefresh)
      sizeObserver.observe(el.value)
    }
    if (typeof MutationObserver !== 'undefined') {
      domObserver = new MutationObserver(scheduleRefresh)
      domObserver.observe(el.value, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      })
    }
  })

  onBeforeUnmount(() => {
    sizeObserver?.disconnect()
    domObserver?.disconnect()
    sizeObserver = null
    domObserver = null
  })
}
