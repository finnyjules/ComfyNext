// Append-only sync between a node's saved output snapshot and the current
// /object_info schema. Saved workflows freeze `data.outputs` at creation time,
// so when the backend later ADDS an output to a node type (e.g. Timeline grew
// a `video` output after `frames`), old saves never show the new port.
//
// Append-only is the only safe merge: existing edges reference outputs by
// index (`output-${i}`), so we must never reorder or remove — only append the
// missing trailing schema outputs.

export interface NodeOutputPort {
  name: string
  type: string
  links: number[] | null
}

/** Build the schema-defined output list from an /object_info entry. */
export function schemaOutputsFromInfo(info: any): NodeOutputPort[] {
  return ((info?.output || []) as string[]).map((type, i) => ({
    name: info?.output_name?.[i] || type,
    type,
    links: null,
  }))
}

/**
 * Returns the merged output list when the schema defines MORE outputs than the
 * saved snapshot (saved outputs kept verbatim + missing trailing schema
 * outputs appended), or `null` when no change is needed:
 *  - schema unknown/empty (objectInfo missing the type) → null
 *  - saved already has >= schema outputs (incl. saved-has-more) → null
 */
export function syncNodeOutputsWithSchema(
  saved: NodeOutputPort[] | undefined | null,
  schema: NodeOutputPort[] | undefined | null,
): NodeOutputPort[] | null {
  const have = saved ?? []
  if (!schema?.length) return null
  if (schema.length <= have.length) return null
  return [...have, ...schema.slice(have.length)]
}
