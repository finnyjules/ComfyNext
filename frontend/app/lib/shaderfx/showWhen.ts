export interface ShowWhen { uniform: string; equals: number | number[] }

/**
 * A param's visibility gate. A single `ShowWhen` matches when its uniform's
 * (rounded — enum uniforms are floats) value is/among `equals`. An ARRAY of
 * `ShowWhen` is an AND: every condition must match. That's how a param gates on
 * two uniforms at once — e.g. crystal_prism's facet jitter needs BOTH Faceted
 * mode AND the Triangles facet style; neither uniform alone is sufficient.
 */
export function matchesShowWhen(showWhen: ShowWhen | ShowWhen[] | undefined, read: (uniform: string) => number): boolean {
  if (!showWhen) return true
  const conds = Array.isArray(showWhen) ? showWhen : [showWhen]
  return conds.every((c) => {
    const v = Math.round(read(c.uniform))
    return Array.isArray(c.equals) ? c.equals.includes(v) : v === c.equals
  })
}
