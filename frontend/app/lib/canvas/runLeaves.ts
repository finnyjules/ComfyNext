// Leaf set of an active run: the nodes that are the run's OUTPUTS — members of
// the run with no outgoing edge to another in-run node. Generation FX (img-fx
// churn/dither, glimm sweep) belong on these and only these: an intermediate
// result that merely feeds the next generator is an *input* to the run's tail,
// and painting the churn on it reads as "this image is being replaced" when it
// isn't. Pure and Vue-free so the rule is unit-testable.

export interface EdgeLike {
  source: string | number
  target: string | number
}

/**
 * Compute the leaves of `runIds` under `edges`: every run member that has no
 * outgoing edge whose target is ALSO a run member. Edges to nodes outside the
 * run don't count against leaf status. Empty run → empty leaves.
 */
export function computeRunLeafIds(runIds: Set<string>, edges: EdgeLike[]): Set<string> {
  const leaves = new Set<string>()
  for (const id of runIds) leaves.add(String(id))
  if (!leaves.size) return leaves
  for (const e of edges) {
    const s = String(e.source)
    if (!leaves.has(s)) continue
    if (runIds.has(String(e.target))) leaves.delete(s)
  }
  return leaves
}
