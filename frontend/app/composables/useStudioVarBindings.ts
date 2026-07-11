// The seam that makes studio controls bindable to Collection columns.
//
// Three pure functions (testable without a component) plus a thin reactive
// composable that surfaces call from `nodeId`.
//
// Node/edge access: surfaces such as GradientStudioSurface only receive
// `nodeId` (+ sometimes a `nodes` prop) — not raw canvas internals. This
// composable therefore takes `accessors: { nodes: () => any[]; edges: () =>
// any[]; createCollectionNode?: () => any }` so callers can wire whatever
// channel they have (props, a store, etc.) without this file importing
// canvas internals directly. When a surface has no way to create a
// collection node itself, `promote()` falls back to dispatching a
// `sailor:promoteControl` CustomEvent for VueNodeCanvas to handle.

import { computed, watch } from 'vue'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { clampForControl, controlKindToVariableType } from '~/lib/collection/studioBindables'
import { BINDINGS_PROP, COLLECTION_PROP, VAR_PREVIEW_PROP } from '~/lib/collection/types'
import type { CollectionData, VarBindings } from '~/lib/collection/types'
import { addColumn, addRow, clampPreviewRow, setCell } from '~/lib/collection/model'
import { resolveBindings } from '~/lib/collection/resolve'
import { makeLookupResolver } from '~/lib/collection/lookup'

export interface VarPreviewPayload {
  params?: Record<string, string | number>
  props?: Record<string, string>
  brand?: Record<string, string>
  ts?: number
}

/** Apply a resolved `params.*` preview payload onto live studio control state.
 *  Clamps each value via `clampForControl` (skipping invalid colors) and only
 *  applies keys that have a matching control. Returns the keys actually applied. */
export function applyParamsPreview(
  preview: { params?: Record<string, string | number> } | undefined,
  controls: StudioControlDesc[],
  apply: (key: string, value: string | number) => void,
): string[] {
  const applied: string[] = []
  const params = preview?.params
  if (!params) return applied
  const byKey = new Map(controls.map(c => [c.key, c]))
  for (const [key, value] of Object.entries(params)) {
    const control = byKey.get(key)
    if (!control) continue
    const clamped = clampForControl(control, value)
    if (control.kind === 'color' && clamped === '') continue
    apply(key, clamped)
    applied.push(key)
  }
  return applied
}

function findNode(nodes: any[], id: string): any | undefined {
  return nodes.find(n => String(n.id) === String(id))
}

/** Find the collection node wired into `studioNodeId` via a VARS edge, verifying
 *  the edge's source node actually owns the collection referenced by `collectionId`.
 *  Exported so other binding modules (e.g. layoutBinding.ts) reuse this exact
 *  lookup instead of re-implementing it. */
export function findWiredCollectionNode(nodes: any[], edges: any[], studioNodeId: string, collectionId?: string): any | undefined {
  const wiredSourceIds = new Set(
    edges
      .filter(e => String(e.target) === String(studioNodeId) && e?.data?.dataType === 'VARS')
      .map(e => String(e.source)),
  )
  return nodes.find((n) => {
    if (!wiredSourceIds.has(String(n.id))) return false
    const c = n?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
    if (!c) return false
    return collectionId === undefined || c.id === collectionId
  })
}

/** Resolve a bound control's DISPLAY name: the wired column's current
 *  user-editable `label`, NOT its stable `columnKey`. A column's key is frozen
 *  at creation time (derived from the label then via `keyFromLabel`), so once
 *  the user renames the column header the key no longer matches — surfacing the
 *  key in the studio would show the stale original name. Falls back to the
 *  `columnKey` when the column or collection can't be resolved (dangling
 *  binding). Returns null when the control isn't bound. */
export function boundColumnLabel(
  nodes: any[],
  edges: any[],
  studioNodeId: string,
  bindings: VarBindings,
  controlKey: string,
): string | null {
  const binding = bindings[`params.${controlKey}`]
  if (!binding) return null
  const colNode = findWiredCollectionNode(nodes, edges, studioNodeId, binding.collectionId)
  const c = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
  const label = c?.columns.find(col => col.key === binding.columnKey)?.label
  return label ?? binding.columnKey
}

/** Write-through: editing a bound control updates the underlying collection's
 *  preview-row cell (and the binding's frozen fallback). Returns true if written. */
export function writeThroughEdit(
  nodesAccessor: () => any[],
  edgesAccessor: () => any[],
  studioNodeId: string,
  path: string,
  value: string | number,
): boolean {
  const nodes = nodesAccessor()
  const edges = edgesAccessor()
  const studio = findNode(nodes, studioNodeId)
  const bindings = studio?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined
  const binding = bindings?.[path]
  if (!binding) return false

  const colNode = findWiredCollectionNode(nodes, edges, studioNodeId, binding.collectionId)
  if (!colNode) return false
  const c = colNode.data.properties[COLLECTION_PROP] as CollectionData
  const row = c.rows[c.previewRow]
  if (!row) return false

  // Convergence guard (layer 2 of 2 — see the `applying` flag in
  // useStudioVarBindings' watch for layer 1): if the target cell already
  // strictly equals the incoming value, don't touch the collection at all.
  // The watch/apply/write-through cycle can re-fire across an async hop that
  // the `applying` flag can't cover (e.g. a producer stamping a fresh
  // `ts: Date.now()` on an otherwise-identical preview payload); a no-op
  // write here stops that from looping forever instead of relying solely on
  // the flag.
  if (row.values[binding.columnKey] === value) {
    binding.lastLiteral = value
    return true
  }

  setCell(c, row.id, binding.columnKey, value)
  binding.lastLiteral = value
  return true
}

/** Promote a literal control value to a bound collection column: reuses the
 *  already-wired collection if present, otherwise calls `createCollectionNode()`.
 *  Adds a typed column named from `control.label`, seeds the preview row's cell
 *  with `currentValue`, and writes the binding onto the studio node. */
export function promoteControl(
  nodesAccessor: () => any[],
  edgesAccessor: () => any[],
  studioNodeId: string,
  control: StudioControlDesc,
  currentValue: string | number,
  createCollectionNode: () => any,
): { columnKey: string } | null {
  const nodes = nodesAccessor()
  const edges = edgesAccessor()
  const studio = findNode(nodes, studioNodeId)
  if (!studio) return null

  let colNode = findWiredCollectionNode(nodes, edges, studioNodeId)
  if (!colNode) {
    colNode = createCollectionNode()
  }
  if (!colNode) return null

  const c = colNode.data.properties[COLLECTION_PROP] as CollectionData
  if (!c) return null

  const type = controlKindToVariableType(control.kind) ?? 'text'
  const column = addColumn(c, control.label, type)

  // A stale/out-of-range previewRow (e.g. rows were removed elsewhere) must
  // not silently append an orphan row on a non-empty collection — clamp
  // first and only create a row when the collection is genuinely empty.
  clampPreviewRow(c)
  let row = c.rows[c.previewRow]
  if (!row) row = addRow(c)
  setCell(c, row.id, column.key, currentValue)

  if (!studio.data.properties) studio.data.properties = {}
  const bindings = (studio.data.properties[BINDINGS_PROP] ?? {}) as VarBindings
  const path = `params.${control.key}`
  bindings[path] = { collectionId: c.id, columnKey: column.key, lastLiteral: currentValue }
  studio.data.properties[BINDINGS_PROP] = bindings

  return { columnKey: column.key }
}

export interface StudioVarBindingsAccessors {
  nodes: () => any[]
  edges: () => any[]
  /** Creates a new Collection node + VARS edge into the studio and returns the node.
   *  When absent (surface has no direct canvas access), `promote()` falls back to
   *  dispatching a `sailor:promoteControl` CustomEvent for VueNodeCanvas to handle. */
  createCollectionNode?: () => any
}

/** Reactive shell over the pure functions above, used by studio surfaces. */
export function useStudioVarBindings(
  nodeId: string,
  controls: () => StudioControlDesc[],
  applyParam: (key: string, value: string | number) => void,
  accessors: StudioVarBindingsAccessors,
) {
  const { nodes, edges, createCollectionNode } = accessors

  // Convergence guard (layer 1 of 2 — see writeThroughEdit for layer 2): the
  // cycle is watch(VAR_PREVIEW_PROP) -> applyParamsPreview -> surface apply
  // -> control update handler -> onEdit -> writeThroughEdit -> (studio
  // pushVarPreview producer) -> watch again. `applying` marks the window
  // where the watch callback is driving control updates itself, so onEdit
  // can tell an apply-driven update apart from a real user edit and skip the
  // write-through that would otherwise re-trigger the producer. Mirrors the
  // loop-warning convention in CollectionDrawer.vue (~lines 87-89) for the
  // sibling collection -> target preview watch.
  let applying = false

  function currentNode(): any | undefined {
    return findNode(nodes(), nodeId)
  }

  const bindings = computed<VarBindings>(() => {
    return (currentNode()?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined) ?? {}
  })

  function boundColumnFor(controlKey: string): string | null {
    // Delegate to the pure resolver so the studio shows the column's current
    // display label (not its frozen key). Reads `bindings.value` (computed) and
    // `nodes()`/`edges()` reactively, so a column rename re-renders the control.
    return boundColumnLabel(nodes(), edges(), nodeId, bindings.value, controlKey)
  }

  function onEdit(controlKey: string, value: string | number): boolean {
    // Apply-driven control updates (the watch below pushing a resolved
    // preview value onto the control) are not user edits — writing them
    // through would re-trigger the collection preview producer and loop.
    if (applying) return false
    const path = `params.${controlKey}`
    if (!bindings.value[path]) return false
    return writeThroughEdit(nodes, edges, nodeId, path, value)
  }

  function promote(control: StudioControlDesc, currentValue: string | number): { columnKey: string } | null {
    const wired = findWiredCollectionNode(nodes(), edges(), nodeId)
    if (!wired && !createCollectionNode) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sailor:promoteControl', {
          detail: { nodeId, control, currentValue },
        }))
      }
      return null
    }
    return promoteControl(nodes, edges, nodeId, control, currentValue, createCollectionNode ?? (() => null))
  }

  /** Unbind a control from its collection column, freezing its last value so
   *  the control doesn't lose its value once the binding is gone. Freeze
   *  order: (1) the resolved collection value if the wired collection is
   *  still reachable, (2) the caller-supplied `currentValue` (the control's
   *  live on-screen value — surfaces pass this so an unbind after the wired
   *  collection has already vanished still freezes something sane), (3)
   *  fall back to whatever `lastLiteral` was already recorded. */
  function unbind(controlKey: string, currentValue?: string | number): void {
    const path = `params.${controlKey}`
    const node = currentNode()
    const nodeBindings = node?.data?.properties?.[BINDINGS_PROP] as VarBindings | undefined
    const binding = nodeBindings?.[path]
    if (!binding || !node) return

    const colNode = findWiredCollectionNode(nodes(), edges(), nodeId, binding.collectionId)
    const c = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
    if (c) {
      const { values } = resolveBindings(c, { [path]: binding }, c.previewRow, makeLookupResolver(nodes()))
      if (values[path] !== undefined) binding.lastLiteral = values[path]
      else if (currentValue !== undefined) binding.lastLiteral = currentValue
    } else if (currentValue !== undefined) {
      binding.lastLiteral = currentValue
    }
    delete nodeBindings![path]
  }

  watch(
    () => currentNode()?.data?.properties?.[VAR_PREVIEW_PROP],
    (preview) => {
      applying = true
      try {
        applyParamsPreview(preview as VarPreviewPayload | undefined, controls(), applyParam)
      } finally {
        applying = false
      }
    },
    { deep: true },
  )

  return { bindings, boundColumnFor, onEdit, promote, unbind }
}
