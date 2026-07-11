// Promotes a Smart Layout text/image element to a bound Collection column.
// Mirrors useStudioVarBindings' `promoteControl` (see that file for the
// studio-control equivalent) but binds a fixed `props.<socketName>` path
// instead of `params.<control.key>`, since layout elements are addressed by
// their tokenized socket name rather than a StudioControlDesc.

import type { ComputedRef } from 'vue'
import { BINDINGS_PROP, COLLECTION_PROP } from './types'
import type { CollectionData, VarBindings } from './types'
import { addColumn, addRow, clampPreviewRow, setCell } from './model'
import { findWiredCollectionNode } from '~/composables/useStudioVarBindings'

function findNode(nodes: any[], id: string): any | undefined {
  return nodes.find(n => String(n.id) === String(id))
}

/** Shape provided by SmartLayoutEditorModal.vue under the `smartLayoutBinding`
 *  injection key — everything GridEditorCanvas.vue / GridPropertyPanel.vue need
 *  to detect + act on element↔column bindings without their own VARS-edge
 *  lookups (nodeId threading choice for Task 3: provide/inject pierces
 *  GridEditorShell without adding SmartLayout-specific plumbing to the
 *  generic grid-editor composable). */
export interface SmartLayoutBindingContext {
  nodeId: string
  nodesAccessor: () => any[]
  edgesAccessor: () => any[]
  /** Live `sailor_varBindings` on the SmartLayout node (`props.<socket>` keyed). */
  bindings: ComputedRef<VarBindings>
  /** The Collection node wired into this SmartLayout via a VARS edge, if any. */
  collectionNode: ComputedRef<any | undefined>
}

/** Promote a Smart Layout element's literal content to a bound collection column:
 *  reuses the already-wired collection if present, otherwise calls
 *  `createCollectionNode()`. Adds a column typed `image` or `text` (from `kind`)
 *  labeled `columnLabel`, seeds the clamped preview row's cell with `currentValue`,
 *  and writes a `props.<socketName>` binding (with `lastLiteral`) onto the layout node. */
export function promoteLayoutElement(
  nodesAccessor: () => any[],
  edgesAccessor: () => any[],
  layoutNodeId: string,
  socketName: string,
  columnLabel: string,
  currentValue: string | number,
  kind: 'text' | 'image',
  createCollectionNode: () => any,
): { columnKey: string } | null {
  const nodes = nodesAccessor()
  const edges = edgesAccessor()
  const layoutNode = findNode(nodes, layoutNodeId)
  if (!layoutNode) return null

  let colNode = findWiredCollectionNode(nodes, edges, layoutNodeId)
  if (!colNode) {
    colNode = createCollectionNode()
  }
  if (!colNode) return null

  const c = colNode.data.properties[COLLECTION_PROP] as CollectionData
  if (!c) return null

  const type = kind === 'image' ? 'image' : 'text'
  const column = addColumn(c, columnLabel, type)

  // A stale/out-of-range previewRow (e.g. rows were removed elsewhere) must
  // not silently append an orphan row on a non-empty collection — clamp
  // first and only create a row when the collection is genuinely empty.
  clampPreviewRow(c)
  let row = c.rows[c.previewRow]
  if (!row) row = addRow(c)
  setCell(c, row.id, column.key, currentValue)

  if (!layoutNode.data.properties) layoutNode.data.properties = {}
  const bindings = (layoutNode.data.properties[BINDINGS_PROP] ?? {}) as VarBindings
  const path = `props.${socketName}`
  bindings[path] = { collectionId: c.id, columnKey: column.key, lastLiteral: currentValue }
  layoutNode.data.properties[BINDINGS_PROP] = bindings

  return { columnKey: column.key }
}
