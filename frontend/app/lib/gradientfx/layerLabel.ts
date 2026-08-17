import { effectiveLayout, LAYOUT_LABELS, type GradientConfig } from './types'

/**
 * Human names for a gradient's layers, derived from what each layer actually IS
 * rather than where it sits in the stack.
 *
 * A layer is named by its GRADIENT LAYOUT (Linear / Radial / Conic / Curve /
 * Linear stripes / …) — the primary identity now that each layer can be its own
 * layout type. (Previously named by shape variant, which only made sense when the
 * whole gradient shared one layout.)
 *
 * Positional names ("Layer 1", "Layer 2") renumber on every reorder, which is
 * confusing on its own and actively misleading now that motion tracks reference
 * layers: reordering renamed both the layer AND its motion targets, so a track
 * that had correctly followed its layer looked like it had jumped.
 *
 * Labels are guaranteed unique — repeats of the same kind get an ordinal — because
 * animatableTargets() builds motion-dropdown entries from them and two identical
 * labels would make two different targets indistinguishable.
 */

/** The kind of a single layer, before de-duplication: its effective layout's label. */
function layerKind(cfg: GradientConfig, i: number): string | null {
  return LAYOUT_LABELS[effectiveLayout(cfg, i)] ?? null
}

/**
 * One label per layer, in stack order. Falls back to a positional name for a
 * layer whose kind can't be determined (an unrecognised or missing shape type),
 * so the list is never sparse.
 */
export function layerLabels(cfg: GradientConfig): string[] {
  const kinds = (cfg.layers ?? []).map((_l, i) => layerKind(cfg, i))
  const seen = new Map<string, number>()
  return kinds.map((kind, i) => {
    if (!kind) return `Layer ${i + 1}`
    const n = (seen.get(kind) ?? 0) + 1
    seen.set(kind, n)
    return n === 1 ? kind : `${kind} ${n}`
  })
}

/** The label for a single layer. Derived from the whole stack, since names de-duplicate. */
export function layerLabel(cfg: GradientConfig, i: number): string {
  return layerLabels(cfg)[i] ?? `Layer ${i + 1}`
}
