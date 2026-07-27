// Append-only sync between a node's saved port snapshot and the current
// /object_info schema. Saved workflows freeze `data.outputs`/`data.inputs` at
// creation time, so when the backend later ADDS a port to a node type (e.g.
// Timeline grew a `video` output after `frames`), old saves never show it.
//
// Append-only is the only safe merge: existing edges reference ports by
// index (`output-${i}` / `input-${i}`), so we must never reorder or remove —
// only append the missing trailing schema ports.
import { linkInputPorts } from '~/lib/portIntent'

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

export interface NodeInputPort {
  name: string
  type: string
  link: number | null
  optional?: boolean
}

/** Build the schema-defined link-input list from an /object_info entry. */
export function schemaInputsFromInfo(info: any): NodeInputPort[] {
  return linkInputPorts(info).map(p => ({ ...p, link: null }))
}

/**
 * Input twin of syncNodeOutputsWithSchema — same append-only contract (edges
 * reference inputs by index via `input-${i}`, so never reorder or remove).
 * Lets old saves pick up inputs a node type grew later (e.g. the
 * GenerateImageNode / EditImageNode reference-image ports).
 */
export function syncNodeInputsWithSchema(
  saved: NodeInputPort[] | undefined | null,
  schema: NodeInputPort[] | undefined | null,
): NodeInputPort[] | null {
  const have = saved ?? []
  if (!schema?.length) return null
  if (schema.length <= have.length) return null
  return [...have, ...schema.slice(have.length)]
}
