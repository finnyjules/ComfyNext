/**
 * One placement rule for every node's ports.
 *
 * Ports used to be positioned two incompatible ways: labelled pill rows inside
 * the vertical stack on graph nodes, and bare dots on artifact/studio nodes with
 * hand-tuned inline offsets (50%, 62%, 72%, 38px, 22px, or nothing). Seven
 * different vertical positions, several of them silently coupled to a header's
 * height — so changing a header dragged the wires with it.
 *
 * Now: the port stack is centred on the node's vertical midpoint, inputs down
 * the left edge and outputs down the right. Identical maths for every node type,
 * coupled to nothing — a header can grow or a preview can collapse and the ports
 * stay put relative to the node's centre.
 *
 * Ports are rendered as SIBLINGS of the node card, not children, so the card's
 * opaque background occludes their inner half and each dot reads as tucked in
 * behind the node. A child cannot paint behind its own parent's background.
 */

/** Centre-to-centre spacing between consecutive ports on the same edge. */
export const PORT_PITCH = 20

/**
 * Vertical offset of port `index` from the node's centre, in px.
 *
 * The first port sits dead centre and every later one stacks BELOW it. The
 * offset deliberately ignores how many ports there are: a stack that re-centred
 * itself would shift every existing port whenever a new one appeared, which
 * moves ports out from under the cursor mid-connection and drags their wires
 * with them. Growing downward leaves existing ports exactly where they were.
 */
export function portOffset(index: number): number {
  return index * PORT_PITCH
}

/**
 * Height a node needs for `count` ports to stay within its bounds.
 *
 * Ports grow downward from the centre, so the last one sits `(count - 1)` pitches
 * below the midpoint; the node must be twice that, plus a port's own height, to
 * enclose it. Callers apply this as a `min-height`.
 */
export function minHeightForPorts(count: number): number {
  if (count <= 1) return 0
  return (2 * count - 1) * PORT_PITCH
}
