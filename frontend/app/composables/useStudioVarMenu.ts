import { computed, ref } from 'vue'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { typeCompatible } from '~/lib/collection/bindables'
import { addSweepRows } from '~/lib/collection/model'
import { COLLECTION_PROP, VARS_TYPE, type CollectionColumn, type CollectionData } from '~/lib/collection/types'
import { effectiveColumns, makeLookupResolver } from '~/lib/collection/lookup'
import type { MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'

/**
 * Collection variable-menu / sweep block shared by the studio surfaces
 * (Gradient/Shape/Shader/Texture — Space Type keeps its own copy for now, mid-
 * refactor in another session). Extracted verbatim from the four surfaces:
 * same `wiredColumns`/`findWiredCollectionNode`/`sweepPopover`/`applySweep`/
 * `varMenu`/`openVarMenu`/`goToCollection` behaviour, just parameterized over
 * accessors instead of `props.*` and a direct params-object index.
 */
export function useStudioVarMenu(opts: {
  nodeId: () => string
  nodes: () => any[]
  edges: () => any[]
  /** Reads a control's CURRENT value. A function, not a params object: Texture's
   *  params is a flat reactive record while Gradient/Shape/Shader use a dotted-path
   *  proxy (paramsProxy/agentParams) — indexing internally would bake in that
   *  assumption and break Texture. */
  liveValue: (key: string) => string | number
  boundColumnFor: (key: string) => string | null
  boundColumnKeyFor: (key: string) => string | null
  promote: (control: StudioControlDesc, value: string | number) => void
  unbind: (key: string, value: string | number) => void
}) {
  const { nodeId, nodes, edges, liveValue, boundColumnFor, boundColumnKeyFor, promote, unbind } = opts

  // Wired collection lookup (studio -> collection) for the "Bind to" submenu.
  const wiredColumns = computed<CollectionColumn[]>(() => {
    const edgeList = edges()
    const edge = edgeList.find((e: any) => String(e.target) === String(nodeId()) && e?.data?.dataType === VARS_TYPE)
    if (!edge) return []
    const colNode = nodes().find((n: any) => String(n.id) === String(edge.source))
    const c = colNode?.data?.properties?.[COLLECTION_PROP]
    if (!c) return []
    return effectiveColumns(c, makeLookupResolver(nodes()))
  })

  // Wired collection NODE (not just its columns) — the sweep flow needs to
  // mutate the actual CollectionData object once the popover's Apply fires.
  //
  // Kept as first-VARS-edge lookup with no collection-ownership filter, matching
  // every surface's pre-extraction behaviour exactly. A shared collection-aware
  // helper exists and is better (handles multiple/ambiguous wirings), but
  // switching to it is a BEHAVIOUR CHANGE — follow-up, not part of this refactor.
  function findWiredCollectionNode(): any | null {
    const edgeList = edges()
    const edge = edgeList.find((e: any) => String(e.target) === String(nodeId()) && e?.data?.dataType === VARS_TYPE)
    if (!edge) return null
    return nodes().find((n: any) => String(n.id) === String(edge.source)) ?? null
  }

  // Wired collection node id — shared by the var-menu's "Go to collection" item
  // and any surface-level "edit in table" affordance (Shape's FillSwatch,
  // Texture's bound-row button).
  function wiredCollectionNodeId(): string | null {
    const edgeList = edges()
    const edge = edgeList.find((ed: any) => String(ed.target) === String(nodeId()) && ed?.data?.dataType === VARS_TYPE)
    return edge ? String(edge.source) : null
  }
  function goToCollection() {
    const id = wiredCollectionNodeId()
    if (id) window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: id } }))
  }

  // Sweep popover state — opened from the "Sweep…" chip menu item on a bound
  // control; on Apply, turns the entered values into sweep rows on the wired
  // collection and hands off to the drawer + a follow-up run event.
  const sweepPopover = ref<{ control: StudioControlDesc; anchor: { x: number; y: number } } | null>(null)
  function applySweep(values: (string | number)[]) {
    const control = sweepPopover.value?.control
    sweepPopover.value = null
    if (!control) return
    const colNode = findWiredCollectionNode()
    const collection = colNode?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
    if (!colNode || !collection) return
    const columnKey = boundColumnKeyFor(control.key)
    if (!columnKey) return

    const added = addSweepRows(collection, columnKey, values)
    window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: String(colNode.id) } }))
    window.dispatchEvent(new CustomEvent('sailor:runSweepRows', {
      detail: { collectionNodeId: String(colNode.id), rowIds: added.map(r => r.id), targetNodeId: nodeId() },
    }))
  }

  const varMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
  function openVarMenu(e: MouseEvent, control: StudioControlDesc) {
    const type = controlKindToVariableType(control.kind)
    if (type === null) return
    const value = liveValue(control.key)
    const bound = boundColumnFor(control.key)
    const items: MenuItem[] = []
    if (!bound) {
      items.push({ label: 'Turn into variable', action: () => promote(control, value) })
      const compatCols = wiredColumns.value.filter(col => typeCompatible(type, col.type))
      if (compatCols.length) {
        items.push({
          label: 'Bind to',
          children: compatCols.map(col => ({
            label: col.label,
            action: () => window.dispatchEvent(new CustomEvent('sailor:bindControl', {
              detail: { nodeId: nodeId(), path: `params.${control.key}`, columnKey: col.key },
            })),
          })),
        })
      }
    } else {
      items.push({ label: 'Go to collection', action: goToCollection })
      items.push({ label: 'Sweep…', action: () => { sweepPopover.value = { control, anchor: { x: e.clientX, y: e.clientY } } } })
      items.push({ divider: true })
      items.push({ label: 'Unbind', action: () => unbind(control.key, value) })
    }
    varMenu.value = { x: e.clientX, y: e.clientY, items }
  }

  return { wiredColumns, sweepPopover, applySweep, varMenu, openVarMenu, goToCollection, wiredCollectionNodeId }
}
