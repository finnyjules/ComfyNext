// Prompt-validation error summarization.
//
// When ComfyUI rejects a prompt at validation time (/prompt → HTTP 400), the
// response carries a structured `node_errors` map:
//   { "<node id>": { errors: [{ type, message, details, extra_info }, …],
//                    class_type: "SaveVideo", dependent_outputs: […] }, … }
// The bridge forwards that map with the `queue_error` event; this helper turns
// it into a human-readable toast description plus a per-node message map used
// to paint the offending nodes red on the canvas.

export interface NodeErrorSummary {
  /** Toast body: one "<class_type>: <message>" line per node, max 3 + "…and N more". Empty string if nothing usable. */
  description: string
  /** node id → first error message (with details), for marking nodes on the canvas. */
  perNode: Record<string, string>
}

const MAX_DESCRIPTION_LINES = 3

export function summarizeNodeErrors(nodeErrors: unknown): NodeErrorSummary {
  const perNode: Record<string, string> = {}
  if (!nodeErrors || typeof nodeErrors !== 'object' || Array.isArray(nodeErrors)) {
    return { description: '', perNode }
  }

  const lines: string[] = []
  for (const [nodeId, entry] of Object.entries(nodeErrors as Record<string, any>)) {
    const errors = Array.isArray(entry?.errors) ? entry.errors : []
    const first = errors.find((e: any) => e && typeof e === 'object')
    const message = typeof first?.message === 'string' && first.message ? first.message : 'Validation failed'
    const details = typeof first?.details === 'string' && first.details ? first.details : ''
    const full = details ? `${message} — ${details}` : message
    perNode[nodeId] = full
    const label = typeof entry?.class_type === 'string' && entry.class_type ? entry.class_type : `Node ${nodeId}`
    lines.push(`${label}: ${full}`)
  }

  let description = lines.slice(0, MAX_DESCRIPTION_LINES).join('\n')
  if (lines.length > MAX_DESCRIPTION_LINES) {
    description += `\n…and ${lines.length - MAX_DESCRIPTION_LINES} more`
  }
  return { description, perNode }
}
