/**
 * Widget ordering for a canvas node.
 *
 * The prompt is the thing you came to the node to write, so it goes first whatever
 * order the schema declares. Some generators put a model picker or a size combo above
 * it, which pushes the one control that matters below the fold of the eye.
 */

/** The minimum a widget definition has to look like for these helpers. */
export interface OrderableWidget {
  name: string
  type: string
  multiline?: boolean
}

/**
 * A multiline STRING widget — the prompt. The `multiline` flag is authoritative when the
 * backend sets it; otherwise fall back to the name, which is how Comfy-standard nodes
 * have always been detected here.
 *
 * Exported because `ComfyNodeWidget` decides the SHAPE of a widget with the same test
 * (textarea vs 28px row) while `ComfyNode` decides its POSITION. Two copies would let a
 * widget render as a textarea in one and sort as an ordinary control in the other.
 */
export function isMultilineTextWidget(w: OrderableWidget | undefined | null): boolean {
  if (!w || w.type !== 'STRING') return false
  if (w.multiline != null) return w.multiline
  const n = w.name.toLowerCase()
  return n.includes('text') || n.includes('prompt')
}

/**
 * Widgets with their ORIGINAL index, prompts first, everything else in declared order.
 *
 * The index rides along because `widgetsValues` is positional — sorting the definitions
 * alone would read every value from the wrong slot, which is silent corruption rather
 * than a visible break. Sorting is stable, so two prompts keep their relative order.
 */
export function promptFirst<T extends OrderableWidget>(widgets: readonly T[] | undefined | null): { widget: T; i: number }[] {
  if (!widgets?.length) return []
  const withIndex = widgets.map((widget, i) => ({ widget, i }))
  const prompts = withIndex.filter((e) => isMultilineTextWidget(e.widget))
  if (!prompts.length) return withIndex
  return [...prompts, ...withIndex.filter((e) => !isMultilineTextWidget(e.widget))]
}
