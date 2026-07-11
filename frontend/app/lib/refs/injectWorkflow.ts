import { substituteRefTokens } from './resolve'
import { resolveRefFilename } from './registry'
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

/**
 * Convert every `Reference` node into a backend `Image` node (the unified
 * load/preview node in comfy_extras/nodes_image.py) carrying the resolved
 * input filename, so its downstream IMAGE wire delivers a real image at
 * submit. The node's id/pos/outputs are left untouched — the Reference
 * node's single IMAGE output-0 maps directly onto the Image node's IMAGE
 * output-0, so existing wires stay valid.
 *
 * A Reference whose handle can't be resolved (dangling/deleted @ref) is left
 * untouched as type 'Reference' — it will be stripped as frontend-only,
 * failing safe rather than reaching ComfyUI mis-wired or with garbage widgets.
 */
export function materializeReferenceNodes(workflow: any, reg: RefRegistry): void {
  const nodes: any[] = workflow?.nodes
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (node?.type !== 'Reference') continue
    const filename = resolveRefFilename(reg, node.properties?.sailor_refName ?? '')
    if (!filename) continue
    node.type = 'Image'
    // Full default widgets_values for the Image node's 11 required widgets:
    // image, export, filename_prefix, format, quality, lossless_webp,
    // png_compression, scale, max_dimension, embed_metadata, batch_index
    node.widgets_values = [filename, false, 'ComfyUI', 'png', 90, false, 4, 1.0, 0, true, -1]
  }
}
