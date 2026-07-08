// Pure diff between two ComfyUI API prompts (`ApiPrompt` from
// `~/lib/graph/graphToPrompt`) — used to shadow-compare OUR builder's output
// against the bridge iframe's own `graphToPrompt` on every dev run (Task 8).
//
// Divergence convention: a whole-node add/remove is reported as a single
// `PromptDivergence` with `field: '<node>'` (the whole `ApiNode` sits in
// `ours`/`theirs`, whichever side is missing gets `undefined`). Field-level
// mismatches inside a node that exists on both sides use dotted-path
// `field` strings: `'class_type'` for the node type, `'inputs.<name>'` for
// an individual input.
//
// Benign-equal rules (do NOT report):
//  - Object key order is irrelevant — comparison is by key set + value, not
//    insertion order.
//  - `null` on one side vs the key being entirely absent on the other side
//    are treated as equal (ComfyUI's own prompt builder is inconsistent
//    about emitting explicit nulls for optional inputs). This rule applies
//    at the top level (inputs map); inside nested objects, null and missing
//    are still treated as distinct for clarity.
//  - Link-value arrays (`["4", 0]`) compare element-wise; a real value
//    difference in either the origin id or the slot index is a divergence.
//  - Nested plain objects compare by key set + recursively equal values.
//  - Both-NaN compare as equal (NaN !== NaN in JS, but semantically identical).
//
// Real divergences (DO report):
//  - `1` (number) vs `'1'` (string) — same apparent value, different type;
//    ComfyUI's actual executor is strict about this, so it must surface.
//  - Any other primitive value mismatch.
//  - Extra/missing whole node.
//  - `class_type` mismatch on a shared node id.

import type { ApiNode, ApiPrompt } from '~/lib/graph/graphToPrompt'

export interface PromptDivergence {
  nodeId: string
  field: string
  ours: any
  theirs: any
}

/** Is `value` "nullish" in the benign sense: `null` or `undefined`? Missing
 * key and explicit `null` are indistinguishable via `obj[key]`, which is
 * exactly the benign-equal rule we want. */
function isNullish(value: any): boolean {
  return value === null || value === undefined
}

/** Strict, benign-rule-aware equality for a single field value. Arrays
 * (link values like `["4", 0]`) compare element-wise with the same rules
 * recursively; plain objects compare by key set + recursively equal values;
 * NaN === NaN special-cased to true; everything else falls back to `===`. */
function valuesEqual(a: any, b: any): boolean {
  if (isNullish(a) && isNullish(b)) return true
  if (isNullish(a) || isNullish(b)) return false

  // Special case: both-NaN compare as equal
  if (Number.isNaN(a) && Number.isNaN(b)) return true

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => valuesEqual(v, b[i]))
  }
  if (Array.isArray(a) || Array.isArray(b)) return false

  // Recurse into plain objects: same key set + all values recursively equal
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    const bKeySet = new Set(bKeys)
    if (!aKeys.every(k => bKeySet.has(k))) return false
    return aKeys.every(k => valuesEqual(a[k], b[k]))
  }

  // Deliberately no numeric/string coercion here: 1 vs '1' must NOT be equal.
  return a === b
}

function diffInputs(nodeId: string, ours: Record<string, any>, theirs: Record<string, any>): PromptDivergence[] {
  const divergences: PromptDivergence[] = []
  const keys = new Set([...Object.keys(ours || {}), ...Object.keys(theirs || {})])
  for (const key of keys) {
    const oursValue = ours?.[key]
    const theirsValue = theirs?.[key]
    if (!valuesEqual(oursValue, theirsValue)) {
      divergences.push({ nodeId, field: `inputs.${key}`, ours: oursValue, theirs: theirsValue })
    }
  }
  return divergences
}

function diffNode(nodeId: string, ours: ApiNode, theirs: ApiNode): PromptDivergence[] {
  const divergences: PromptDivergence[] = []
  if (ours.class_type !== theirs.class_type) {
    divergences.push({ nodeId, field: 'class_type', ours: ours.class_type, theirs: theirs.class_type })
  }
  divergences.push(...diffInputs(nodeId, ours.inputs, theirs.inputs))
  return divergences
}

/**
 * Diffs two API prompts and returns the list of real (non-benign)
 * divergences. Empty array means the prompts are equivalent for execution
 * purposes (modulo the benign-equal rules documented above).
 */
export function diffPrompts(ours: ApiPrompt, theirs: ApiPrompt): PromptDivergence[] {
  const divergences: PromptDivergence[] = []
  const nodeIds = new Set([...Object.keys(ours || {}), ...Object.keys(theirs || {})])

  for (const nodeId of nodeIds) {
    const oursNode = ours?.[nodeId]
    const theirsNode = theirs?.[nodeId]

    if (!oursNode || !theirsNode) {
      divergences.push({ nodeId, field: '<node>', ours: oursNode, theirs: theirsNode })
      continue
    }

    divergences.push(...diffNode(nodeId, oursNode, theirsNode))
  }

  return divergences
}
