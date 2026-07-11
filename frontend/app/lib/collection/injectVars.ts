// Submit-time Collection→SmartLayout var injection.
//
// A SmartLayout element bound to a Collection column (promoteLayoutElement)
// carries a `props.<socket>`/`brand.<key>` binding in `sailor_varBindings`,
// with the values living in the wired Collection node — which is frontend-only
// and stripped before the workflow reaches ComfyUI. The node-face preview and
// the Collection drawer resolve those bindings client-side, but a plain canvas
// Generate would otherwise ship the raw `{{ props.… }}` tokens to the backend,
// which renders them literally (the renderer's resolveTokens keeps unresolved
// whole-string tokens as-is).
//
// This mirrors what the node-face preview shows: resolve each SmartLayout's
// bindings against its collection's preview row and bake the values into the
// `layout` widget JSON before the workflow leaves the frontend. Runs on the
// deep-copied run workflow only — the live canvas nodes keep their tokens.

import { BINDINGS_PROP, COLLECTION_PROP } from './types'
import type { CollectionData, VarBindings } from './types'
import { resolveBindings } from './resolve'
import { getNamedWidget, setNamedWidget } from '~/composables/useFilteredPrompt'

const BOUND_TOKEN_RE = /\{\{\s*((?:props|brand)\.\w+)\s*\}\}/g

/** Replace `{{ props.x }}` / `{{ brand.y }}` tokens whose path is present in
 *  `values`; any other token (unbound socket, backend-resolved brand key)
 *  passes through untouched. */
export function substituteBoundTokens(
  value: string,
  values: Record<string, string | number>,
): string {
  return value.replace(BOUND_TOKEN_RE, (token, path) => {
    const v = values[path]
    return v === undefined ? token : String(v)
  })
}

/** Deep-walk any JSON value, applying substituteBoundTokens to every string. */
function substituteDeep(value: unknown, values: Record<string, string | number>): unknown {
  if (typeof value === 'string') return substituteBoundTokens(value, values)
  if (Array.isArray(value)) return value.map(v => substituteDeep(v, values))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = substituteDeep(v, values)
    return out
  }
  return value
}

/** Resolve a SmartLayout node's bindings to a `path → value` map. Bindings
 *  whose collection is present resolve against its preview row (with
 *  resolveBindings' own lastLiteral fallback for missing cells); bindings
 *  whose collection node was deleted fall back to their lastLiteral. */
function resolveNodeVarValues(
  bindings: VarBindings,
  collections: CollectionData[],
): Record<string, string | number> {
  const values: Record<string, string | number> = {}
  const byId = new Map(collections.map(c => [c.id, c]))
  const seenCollections = new Set<string>()
  for (const [path, b] of Object.entries(bindings)) {
    if (!b) continue
    const c = byId.get(b.collectionId)
    if (c) {
      if (!seenCollections.has(c.id)) {
        seenCollections.add(c.id)
        Object.assign(values, resolveBindings(c, bindings, c.previewRow).values)
      }
    } else if (b.lastLiteral !== undefined) {
      values[path] = b.lastLiteral
    }
  }
  return values
}

/**
 * Bake Collection-bound var values into every active SmartLayout node's
 * `layout` widget in a LiteGraph-shaped run workflow. Must run BEFORE
 * frontend-only nodes are stripped (the Collection nodes hold the values).
 * Mutates `workflow` in place; nodes without bindings are left untouched, and
 * a malformed layout JSON is skipped rather than aborting the run (the backend
 * will surface its own parse error).
 */
export function injectSmartLayoutVars(
  workflow: { nodes?: any[] },
  objectInfo: Record<string, any>,
): void {
  const nodes = workflow?.nodes
  if (!Array.isArray(nodes) || !nodes.length) return

  const collections = nodes
    .map(n => n?.properties?.[COLLECTION_PROP] as CollectionData | undefined)
    .filter((c): c is CollectionData => !!c?.id)

  for (const node of nodes) {
    if (node?.type !== 'SmartLayout') continue
    if ((node.mode ?? 0) !== 0) continue // muted/bypassed won't execute
    const bindings = node.properties?.[BINDINGS_PROP] as VarBindings | undefined
    if (!bindings || !Object.keys(bindings).length) continue

    const values = resolveNodeVarValues(bindings, collections)
    if (!Object.keys(values).length) continue

    const raw = getNamedWidget(node, 'layout', objectInfo)
    if (typeof raw !== 'string' || !raw.trim()) continue
    let layout: unknown
    try {
      layout = JSON.parse(raw)
    } catch {
      continue // malformed layout — let the backend report it
    }
    setNamedWidget(node, 'layout', JSON.stringify(substituteDeep(layout, values)), objectInfo)
  }
}
