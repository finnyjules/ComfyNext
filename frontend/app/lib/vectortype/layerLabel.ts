import { VT_LAYER_KINDS, type VtAppearanceLayer, type VtLayerKind } from './config'

/**
 * Human names for the appearance stack's layers, derived from what each layer
 * actually IS rather than where it sits.
 *
 * Same rule, and the same reasons, as `gradientfx/layerLabel.ts`:
 *
 *  - Positional names ("Layer 1", "Layer 2") renumber on every reorder, which is
 *    confusing on its own and actively misleading once motion tracks reference
 *    layers: reordering renamed both the layer AND its motion targets, so a
 *    track that had correctly followed its layer looked like it had jumped.
 *  - Labels are guaranteed UNIQUE — repeats of the same kind get an ordinal —
 *    because a motion dropdown is built from them and two identical entries
 *    would make two different targets indistinguishable.
 *
 * ## Why the KIND, and not the paint type
 *
 * Gradient names a layer for its shape, because a gradient layer's shape is what
 * it is. Here the equivalent is the `kind`: it is what decides which controls
 * exist (a stroke has a width, an extrude has four knobs), it is what the paint
 * order is expressed in, and — the part that matters for a name — it is what the
 * user does NOT change casually. Naming a layer for its paint type instead would
 * rename it the moment someone tried `stripes` on it, and rename its motion
 * targets with it. That is the same failure as the positional name, arrived at
 * from the other direction.
 */
const KIND_NAMES: Record<VtLayerKind, string> = {
  fill: 'Fill',
  stroke: 'Stroke',
  extrude: 'Extrude',
}

/** The kind of one layer, before de-duplication. `null` for a layer whose kind
 *  no renderer understands — which is dropped from the picture too, so a
 *  positional fallback is the honest name for it. */
function layerKind(layer: VtAppearanceLayer | null | undefined): VtLayerKind | null {
  const kind = layer?.kind
  return (VT_LAYER_KINDS as readonly string[]).includes(kind as string) ? (kind as VtLayerKind) : null
}

/**
 * One label per layer, in stack order (index 0 = back). Falls back to a
 * positional name for a layer whose kind cannot be determined, so the list is
 * never sparse and never shorter than the stack.
 */
export function vtLayerLabels(layers: readonly VtAppearanceLayer[] | null | undefined): string[] {
  const seen = new Map<string, number>()
  return (layers ?? []).map((layer, i) => {
    const kind = layerKind(layer)
    if (!kind) return `Layer ${i + 1}`
    const name = KIND_NAMES[kind]
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name} ${n}`
  })
}

/** The label for a single layer. Derived from the whole stack, since names
 *  de-duplicate — asking for one in isolation cannot know it is the second Fill. */
export function vtLayerLabel(layers: readonly VtAppearanceLayer[] | null | undefined, i: number): string {
  return vtLayerLabels(layers)[i] ?? `Layer ${i + 1}`
}
