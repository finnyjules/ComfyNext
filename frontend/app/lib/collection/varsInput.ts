import { VARS_TYPE } from './types'

/**
 * Idempotently gives Smart Layout nodes an optional `vars` input handle so a
 * Collection node's VARS output can be wired in. Called on node create AND
 * on workflow load (existing saved SmartLayout nodes predate this input).
 */
export function ensureVarsInput(
  node: { data?: { nodeType?: string; inputs?: { name: string; type: string; link?: unknown; optional?: boolean }[] } },
): void {
  if (node?.data?.nodeType !== 'SmartLayout') return
  if (!Array.isArray(node.data.inputs)) node.data.inputs = []
  if (node.data.inputs.some(i => i.name === 'vars')) return
  node.data.inputs.push({ name: 'vars', type: VARS_TYPE, link: null, optional: true })
}
