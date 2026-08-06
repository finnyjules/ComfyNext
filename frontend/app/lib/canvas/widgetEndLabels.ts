/**
 * Semantic end-labels for a node's numeric widgets: [toward-min, toward-max].
 *
 * Only listed widgets get them, which is what keeps generic numeric widgets
 * uncluttered. `ComfyNodeWidget` is the only caller now that every generic
 * widget renders as a `StudioRow`, which draws the labels under the row for
 * the bounded numbers it routes there. The map and the range test stay out
 * here as plain data and a pure predicate rather than buried in the component.
 */
export const WIDGET_END_LABELS: Record<string, [string, string]> = {
  lora_scale: ['subtle', 'strong'],
  guidance: ['creative', 'literal'],
  num_inference_steps: ['faster', 'more detail'],
  prompt_strength: ['keep input', 'follow prompt'],
  cfg_scale: ['loose', 'strict'],
  denoise: ['keep input', 'reinvent'],
}

/** The labels for a widget name, or null when it has none. */
export function endLabelsFor(name?: string): [string, string] | null {
  return (name && WIDGET_END_LABELS[name]) || null
}

/**
 * Whether a numeric widget's range is finite enough to draw as a filled track.
 * An unbounded or absurd range keeps a plain number field instead.
 */
export function isSliderRange(min?: number, max?: number): boolean {
  if (min == null || max == null || !isFinite(min) || !isFinite(max)) return false
  const span = max - min
  return span > 0 && span <= 1_000_000
}
