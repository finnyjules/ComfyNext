import { substituteRefTokens } from './resolve'
import type { RefRegistry } from './registry'

/**
 * Mode 1 over a serialized workflow: rewrite every STRING widget value,
 * substituting `@name` tokens. Runs client-side at submit, before the graph is
 * sent to ComfyUI. Mutates in place (the caller has already deep-cloned).
 */
export function applyRefPromptTokens(workflow: any, reg: RefRegistry): void {
  const nodes: any[] = workflow?.nodes
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    const vals = node?.widgets_values
    if (!Array.isArray(vals)) continue
    for (let i = 0; i < vals.length; i++) {
      if (typeof vals[i] === 'string' && vals[i].indexOf('@') !== -1) {
        vals[i] = substituteRefTokens(vals[i], reg)
      }
    }
  }
}
