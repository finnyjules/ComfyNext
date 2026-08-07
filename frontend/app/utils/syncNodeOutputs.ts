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
 * Returns the merged output list when the schema defines outputs the saved
 * snapshot lacks BY NAME (saved outputs kept verbatim at their indices +
 * missing schema outputs appended at the tail), or `null` when no change is
 * needed:
 *  - schema unknown/empty (objectInfo missing the type) → null
 *  - every schema name already present in the save → null
 *
 * Names, not lengths: a save can be LONGER than the schema and still be
 * missing new ports (found live 2026-08-07 — a GenerateImageNode saved in the
 * image_1..6 ref-port era never gained style_in/prompt_in because a length
 * check saw 6 >= 2 and bailed). Ports the schema dropped stay in the save
 * untouched — removing or reindexing would re-point edges.
 */
export function syncNodeOutputsWithSchema(
  saved: NodeOutputPort[] | undefined | null,
  schema: NodeOutputPort[] | undefined | null,
): NodeOutputPort[] | null {
  const have = saved ?? []
  if (!schema?.length) return null
  const names = new Set(have.map(p => p.name))
  const missing = schema.filter(p => !names.has(p.name))
  if (!missing.length) return null
  return [...have, ...missing]
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
 * Input twin of syncNodeOutputsWithSchema — same name-aware append-only
 * contract (edges reference inputs by index via `input-${i}`, so never
 * reorder or remove; schema ports missing from the save BY NAME append at
 * the tail). Lets old saves pick up inputs a node type grew later (e.g. the
 * GenerateImageNode taste-wire sockets), including saves from a schema era
 * whose port list has since changed shape entirely.
 */
export function syncNodeInputsWithSchema(
  saved: NodeInputPort[] | undefined | null,
  schema: NodeInputPort[] | undefined | null,
): NodeInputPort[] | null {
  const have = saved ?? []
  if (!schema?.length) return null
  const names = new Set(have.map(p => p.name))
  const missing = schema.filter(p => !names.has(p.name))
  if (!missing.length) return null
  return [...have, ...missing]
}
