/**
 * Positional widget access for a Vue Flow node's ComfyUI widget pair.
 *
 * A node carries its widgets as TWO parallel arrays: `widgetDefs` (the node
 * type's declared widgets, in order) and `widgetsValues` (the values, aligned by
 * INDEX). There is no name on a value — the only way to reach `layer3_scale` is
 * to find its position in the defs and index the values with it. Every host in
 * the app re-implemented that lookup inline (`ArtifactFrameNode`, `VueNodeCanvas`,
 * `Scene3DStudioSurface`, `CompositorModal`, …); this is the one copy the
 * compositor's shared modules use, so the wired write-through and the schema-2
 * migration cannot drift from each other.
 *
 * Pure and dependency-free: no Vue, no DOM. Writes mutate `widgetsValues` in
 * place, which is what keeps a reactive node's widgets reactive.
 */

/** The minimum shape of a node's `data` needed to reach its widgets. */
export interface WidgetHostData {
  widgetsValues?: any[]
  widgetDefs?: { name: string }[]
}

/** Index of `name` in the node type's widget order, or -1 when undeclared. */
export function widgetIdx(data: WidgetHostData | null | undefined, name: string): number {
  return data?.widgetDefs?.findIndex(w => w?.name === name) ?? -1
}

/** Numeric widget value; `fallback` when the widget is undeclared or non-finite. */
export function widgetNum(data: WidgetHostData | null | undefined, name: string, fallback = 0): number {
  const i = widgetIdx(data, name)
  if (i < 0) return fallback
  const v = Number(data?.widgetsValues?.[i])
  return Number.isFinite(v) ? v : fallback
}

/** String widget value; `fallback` when the widget is undeclared or unset. */
export function widgetStr(data: WidgetHostData | null | undefined, name: string, fallback = ''): string {
  const i = widgetIdx(data, name)
  if (i < 0) return fallback
  const v = data?.widgetsValues?.[i]
  return v === undefined || v === null ? fallback : String(v)
}

/**
 * Write a widget value by name. Returns false — writing NOTHING — when the node
 * type does not declare the widget or carries no values array. Failing closed
 * matters: a positional write against a mismatched defs list would silently
 * corrupt a neighbouring widget.
 */
export function setWidget(data: WidgetHostData | null | undefined, name: string, value: any): boolean {
  const i = widgetIdx(data, name)
  if (i < 0 || !data?.widgetsValues) return false
  data.widgetsValues[i] = value
  return true
}
