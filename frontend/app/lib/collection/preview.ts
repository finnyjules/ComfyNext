import { BINDINGS_PROP, COLLECTION_PROP, VAR_PREVIEW_PROP } from './types'
import type { CollectionData, VarBindings } from './types'
import { resolveBindings, splitRenderOverrides } from './resolve'

/** Nodes wired from the collection's `output-0` VARS handle. */
export function wiredTargets(collectionNodeId: string, nodes: any[], edges: any[]): any[] {
  const ids = new Set(
    edges
      .filter(e => String(e.source) === String(collectionNodeId) && e.sourceHandle === 'output-0')
      .map(e => String(e.target)),
  )
  return nodes.filter(n => ids.has(String(n.id)))
}

/** Resolve the collection's current preview row for each bound target and
 *  stamp the result onto `target.data.properties[VAR_PREVIEW_PROP]` so the
 *  node body can render a live thumbnail without re-deriving bindings. */
export function pushVarPreview(collectionNode: any, targets: any[]): void {
  const c = collectionNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
  if (!c) return
  for (const target of targets) {
    const bindings = target?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined
    if (!bindings || !Object.keys(bindings).length) continue
    const { values } = resolveBindings(c, bindings, c.previewRow)
    const { props, brand } = splitRenderOverrides(values)
    if (!target.data.properties) target.data.properties = {}
    target.data.properties[VAR_PREVIEW_PROP] = { props, brand, ts: Date.now() }
  }
}
