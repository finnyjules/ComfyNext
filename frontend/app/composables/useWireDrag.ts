/**
 * Tracks an in-progress wire drag so ports can react to it.
 *
 * Ports no longer carry always-visible labels — they'd shout full-time for a
 * task you do occasionally. Instead a port labels itself on hover, and while a
 * wire is being dragged every type-compatible port lights up and self-labels
 * while incompatible ones dim. The information arrives exactly when you're
 * wiring and never when you're just reading the graph.
 *
 * State is module-level: there is one canvas, and every port reads the same
 * drag. `registerWireDrag()` is called once from the canvas; ports call
 * `useWireDrag()`.
 */
import { useVueFlow } from '@vue-flow/core'

const draggingType = ref<string | null>(null)
const isDragging = ref(false)
let registered = false

/**
 * Resolve the data type behind the handle a drag started from.
 *
 * Handle ids follow `input-<i>` / `output-<i>` on graph nodes. Artifact and
 * studio nodes use their own ids, so this returns null for them — and a null
 * type means "don't dim anything", which degrades to plain hover behaviour
 * rather than mislabelling ports.
 */
function resolveHandleType(node: any, handleId: string | null | undefined): string | null {
  if (!node?.data || !handleId) return null
  const match = /^(input|output)-(\d+)$/.exec(handleId)
  if (!match) return null
  const slots = match[1] === 'input' ? node.data.inputs : node.data.outputs
  return slots?.[Number(match[2])]?.type ?? null
}

/** Called once, from the canvas, to bind Vue Flow's connect lifecycle. */
export function registerWireDrag() {
  if (registered) return
  registered = true

  const { onConnectStart, onConnectEnd, findNode } = useVueFlow()

  onConnectStart(({ nodeId, handleId }) => {
    isDragging.value = true
    draggingType.value = resolveHandleType(findNode(nodeId), handleId)
  })

  const clear = () => {
    isDragging.value = false
    draggingType.value = null
  }
  onConnectEnd(clear)
}

export function useWireDrag() {
  return {
    isDragging: readonly(isDragging),
    draggingType: readonly(draggingType),
  }
}
