// Planning for "Combine into Frame": turn a multi-selection of image nodes into
// a recipe for a Compositor ("Frame") node wired layer1..N. Pure and free of any
// canvas/Vue-Flow dependency so the ordering/cap/placement rules are unit-tested
// in isolation; VueNodeCanvas mints the Compositor and pushes the edges.

/** Max image layers a Compositor accepts — mirrors `_MAX_LAYERS` in
 *  `comfy_extras/nodes_compositor.py`. */
export const MAX_FRAME_LAYERS = 16

const DEFAULT_NODE_WIDTH = 240
const FRAME_GAP = 120

export interface SelectionNode {
  id: string
  position?: { x?: number; y?: number } | null
  data?: {
    outputs?: Array<{ type?: string | null } | null> | null
    size?: number[] | null
  } | null
}

export interface FramePlanLayer {
  /** source node id */
  id: string
  /** index of that node's IMAGE output (feeds `sourceHandle: output-{i}`) */
  outputIndex: number
}

export interface FramePlan {
  /** image nodes to wire, ordered top-to-bottom then left-to-right, capped */
  layers: FramePlanLayer[]
  /** image nodes dropped because they exceeded MAX_FRAME_LAYERS */
  skipped: number
  /** where to drop the new Frame node (right of the selection's bounds) */
  position: { x: number; y: number }
  /** true only when there are >= 2 image nodes — nothing to "combine" below that */
  canCombine: boolean
}

/** Index of a node's first IMAGE output, or -1 if it has none. */
function imageOutputIndex(node: SelectionNode): number {
  const outs = node.data?.outputs ?? []
  return outs.findIndex((o) => String(o?.type ?? '').toUpperCase() === 'IMAGE')
}

/**
 * Plan a Frame (Compositor) from a multi-selection:
 *  - keep only nodes that expose an IMAGE output,
 *  - order them top-to-bottom then left-to-right (so `layer1` is the top-left
 *    image — a predictable stack, independent of click order),
 *  - cap at MAX_FRAME_LAYERS and report how many were dropped,
 *  - place the Frame just to the right of the selection's bounding box.
 * Pure: the caller mints the Compositor and wires `layers` onto layer1..N.
 */
export function planFrameFromSelection(selected: SelectionNode[]): FramePlan {
  const images = (selected ?? [])
    .map((node) => ({ node, oi: imageOutputIndex(node) }))
    .filter((e) => e.oi >= 0)

  images.sort((a, b) => {
    const ay = a.node.position?.y ?? 0
    const by = b.node.position?.y ?? 0
    if (ay !== by) return ay - by
    const ax = a.node.position?.x ?? 0
    const bx = b.node.position?.x ?? 0
    return ax - bx
  })

  const kept = images.slice(0, MAX_FRAME_LAYERS)
  const skipped = images.length - kept.length

  let maxRight = -Infinity
  let minY = Infinity
  for (const { node } of images) {
    const x = node.position?.x ?? 0
    const y = node.position?.y ?? 0
    const w = node.data?.size?.[0] ?? DEFAULT_NODE_WIDTH
    if (x + w > maxRight) maxRight = x + w
    if (y < minY) minY = y
  }
  const position = images.length ? { x: maxRight + FRAME_GAP, y: minY } : { x: 0, y: 0 }

  return {
    layers: kept.map((e) => ({ id: e.node.id, outputIndex: e.oi })),
    skipped,
    position,
    canCombine: kept.length >= 2,
  }
}
