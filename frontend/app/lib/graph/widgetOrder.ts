// Derives, for a given node class_type, the ordered list of input names that
// consume positions in LiteGraph's positional `widgets_values` array.
//
// This mirrors LiteGraph/ComfyUI's own widget-construction rules against the
// `/object_info` schema so later tasks can zip this order against a node's
// `widgets_values` to reconstruct named API inputs.

export type InputSpec = any[]

export interface WidgetSlot {
  name: string
  control?: true
}

export class UnknownNodeTypeError extends Error {
  constructor(public classType: string) {
    super(`Unknown node type: ${classType}`)
  }
}

const WIDGET_PRIMITIVE_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN'])

/**
 * True when a `[type, opts?]` input spec occupies a position in
 * `widgets_values` (a widget), as opposed to being connection-only.
 */
export function isWidgetInput(spec: InputSpec): boolean {
  const [type, opts] = spec
  if (opts?.forceInput === true) return false
  if (Array.isArray(type)) return true
  // Newer (V3-style) schemas encode combos as the literal type "COMBO" with
  // options in the config instead of an inline array — still a widget.
  // Missing this shifted every later positional value (the prompt string
  // ended up in GenerateImageNode's seed slot).
  if (type === 'COMBO') return true
  if (typeof type === 'string' && WIDGET_PRIMITIVE_TYPES.has(type)) return true
  if (opts?.widget) return true
  return false
}

/**
 * The ordered widget slots for `classType`, derived from the node's
 * `input.required`/`input.optional` schema in `/object_info`. Required
 * inputs are iterated before optional ones, both in object-key insertion
 * order. Inputs with `control_after_generate: true` (e.g. seed widgets)
 * get an extra synthetic `<name>__control` slot immediately after them,
 * matching ComfyUI's extra positional value in `widgets_values`.
 */
export function widgetSlots(classType: string, objectInfo: Record<string, any>): WidgetSlot[] {
  const nodeInfo = objectInfo[classType]
  if (!nodeInfo) throw new UnknownNodeTypeError(classType)

  const input = nodeInfo.input ?? {}
  const sections: Record<string, InputSpec>[] = []
  if (input.required) sections.push(input.required)
  if (input.optional) sections.push(input.optional)

  const slots: WidgetSlot[] = []
  for (const section of sections) {
    for (const [name, spec] of Object.entries(section)) {
      if (!isWidgetInput(spec)) continue
      slots.push({ name })
      const opts = spec[1]
      if (opts?.control_after_generate === true) {
        slots.push({ name: `${name}__control`, control: true })
      }
    }
  }
  return slots
}
