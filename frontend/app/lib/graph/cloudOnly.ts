// isPoolEligible — pool-eligibility predicate for parallel dispatch.
//
// Pool workers are `--cpu` ComfyUI instances: only prompts whose EVERY node
// is cloud-billed (runs on a remote API, no local GPU work) or CPU-trivial
// utility work (load/save/preview/batch/gate plumbing) may route there.
// Anything GPU-shaped (samplers, VAE, model loaders, …) must stay on main.
//
// Mirrors the cloud-detection conventions established in
// `~/lib/costEstimate.ts` (`isReplicateBilled` / `isApiCreditBilled`), but
// against `ApiPrompt` (class_type + objectInfo category) rather than the
// canvas-node shape those functions consume.

import type { ApiPrompt } from '~/lib/graph/graphToPrompt'

/** class_types verified against this codebase's core (`nodes.py`),
 *  `custom_nodes/websocket_image_save.py`, and `comfy_extras/nodes_gate.py`
 *  as CPU-trivial plumbing — no GPU tensor work performed. */
const UTILITY_SAFE = new Set([
  'EmptyImage',
  'LoadImage',
  'SaveImage',
  'PreviewImage',
  'ImageBatch',
  'SaveImageWebsocket',
  'ComfyGateNode',
])

/** A node bills to a remote cloud API (Replicate BYOK or credit-billed API
 *  node) rather than running local GPU compute. Same rule as
 *  `isReplicateBilled` / `isApiCreditBilled` in costEstimate.ts, collapsed
 *  into one predicate since pool-eligibility doesn't distinguish billing mode. */
function isCloudNode(classType: string, category: string): boolean {
  return classType.endsWith('RemoteNode') || /\/Replicate$/.test(category) || category.startsWith('api node')
}

/** True iff every node in the prompt is cloud-billed or CPU-trivial utility
 *  work, so the whole prompt can safely run on a `--cpu` pool worker. An
 *  empty prompt, an unknown class_type, or any class_type missing from
 *  objectInfo is conservatively ineligible. */
export function isPoolEligible(prompt: ApiPrompt, objectInfo: Record<string, any>): boolean {
  const entries = Object.values(prompt || {})
  if (entries.length === 0) return false

  return entries.every((node) => {
    const classType = node.class_type
    const info = objectInfo[classType]
    if (!info) return false
    if (UTILITY_SAFE.has(classType)) return true
    return isCloudNode(classType, info.category || '')
  })
}
