import { VARS_TYPE } from './types'

/** Node types that can accept a Collection's VARS output: Smart Layout (props/brand
 *  bindables) plus every studio surface with a `controlsForStudio` adapter (Task 4). */
export const VARS_TARGET_NODE_TYPES = new Set(['SmartLayout', 'SpaceType', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'ShapeStudio', 'VectorType'])

/**
 * Idempotently gives VARS-target nodes (Smart Layout + studios) an optional
 * `vars` input handle so a Collection node's VARS output can be wired in.
 * Called on node create AND on workflow load (existing saved nodes predate
 * this input).
 */
export function ensureVarsInput(
  node: { data?: { nodeType?: string; inputs?: { name: string; type: string; link?: unknown; optional?: boolean }[] } },
): void {
  if (!node?.data?.nodeType || !VARS_TARGET_NODE_TYPES.has(node.data.nodeType)) return
  if (!Array.isArray(node.data.inputs)) node.data.inputs = []
  if (node.data.inputs.some(i => i.name === 'vars')) return
  node.data.inputs.push({ name: 'vars', type: VARS_TYPE, link: null, optional: true })
}
