/**
 * Lightweight undo/redo history for the Vue canvas.
 *
 * Snapshots the canvas (nodes + edges) on a short debounce so typing in a
 * widget doesn't push one entry per keystroke. Cmd/Ctrl+Z restores the
 * previous snapshot; Shift+Cmd/Ctrl+Z redoes it.
 *
 * Designed to be cheap-and-correct over fancy. JSON.stringify clones the
 * snapshot — nodes/edges are plain objects after the Vue Flow round-trip, so
 * this is fine for canvases up to a few hundred nodes.
 */
import { computed, ref } from 'vue'

export interface CanvasSnapshot {
  nodes: any[]
  edges: any[]
}

const MAX_ENTRIES = 50

export function useCanvasHistory() {
  const stack = ref<CanvasSnapshot[]>([])
  const cursor = ref(-1)

  function snapshot(state: CanvasSnapshot) {
    // Drop anything after the cursor — we're branching off this point.
    if (cursor.value < stack.value.length - 1) {
      stack.value = stack.value.slice(0, cursor.value + 1)
    }
    const cloned: CanvasSnapshot = {
      nodes: JSON.parse(JSON.stringify(state.nodes ?? [])),
      edges: JSON.parse(JSON.stringify(state.edges ?? [])),
    }
    stack.value.push(cloned)
    // Cap memory — drop the oldest entry, keep cursor pointing at the head.
    if (stack.value.length > MAX_ENTRIES) {
      stack.value.shift()
    }
    cursor.value = stack.value.length - 1
  }

  const canUndo = computed(() => cursor.value > 0)
  const canRedo = computed(() => cursor.value < stack.value.length - 1)

  function undo(): CanvasSnapshot | null {
    if (!canUndo.value) return null
    cursor.value -= 1
    return stack.value[cursor.value] ?? null
  }

  function redo(): CanvasSnapshot | null {
    if (!canRedo.value) return null
    cursor.value += 1
    return stack.value[cursor.value] ?? null
  }

  function reset() {
    stack.value = []
    cursor.value = -1
  }

  return { snapshot, undo, redo, canUndo, canRedo, reset, stack, cursor }
}
