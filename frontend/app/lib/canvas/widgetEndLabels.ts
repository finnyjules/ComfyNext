/**
 * Semantic end-labels for a node's numeric widgets: [toward-min, toward-max].
 *
 * Only listed widgets get them, which is what keeps generic numeric widgets
 * uncluttered. Shared rather than inlined because two components need the same
 * map now: `WidgetNumber` draws them under its own rail, and `ComfyNodeWidget`
 * draws them under a `StudioRow` for the bounded numbers it routes to the row.
 * One copy, so a widget can never gain labels in one path and not the other.
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
 * Mirrors `WidgetNumber`'s own `useSlider` test exactly — an unbounded or absurd
 * range keeps a plain number field in both paths.
 */
export function isSliderRange(min?: number, max?: number): boolean {
  if (min == null || max == null || !isFinite(min) || !isFinite(max)) return false
  const span = max - min
  return span > 0 && span <= 1_000_000
}
