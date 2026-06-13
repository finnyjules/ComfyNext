/**
 * useNodeClipboard — in-app clipboard for canvas node copy/paste (Cmd+C/Cmd+V).
 *
 * A module-level singleton (not the OS clipboard) so a copy made on one canvas
 * can be pasted into another project tab in the same session, the way ComfyUI's
 * own node clipboard behaves. The buffer holds a position-normalized snapshot of
 * the copied node(s) plus the edges that run *between* copied nodes — wires to
 * nodes outside the selection are intentionally dropped at copy time.
 */
import { ref } from 'vue'

export interface ClipNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: any
}

export interface ClipEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  data?: any
}

export interface NodeClip {
  nodes: ClipNode[]
  edges: ClipEdge[]
}

const buffer = ref<NodeClip | null>(null)

export function useNodeClipboard() {
  function write(clip: NodeClip) { buffer.value = clip }
  function read(): NodeClip | null { return buffer.value }
  function has(): boolean { return !!buffer.value && buffer.value.nodes.length > 0 }
  return { write, read, has }
}
